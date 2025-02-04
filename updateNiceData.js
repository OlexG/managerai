// updateNiceData.js

// Load environment variables from .env file
const dotenv = require('dotenv');
dotenv.config();

const { createClient } = require('@supabase/supabase-js');

// Retrieve credentials from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // needed for GitHub API calls

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Error: Missing Supabase credentials. Please check your .env file.');
  process.exit(1);
}
if (!OPENAI_API_KEY) {
  console.error('Error: Missing OpenAI API key. Please check your .env file.');
  process.exit(1);
}

// Initialize the Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Generate a nontechnical explanation for a commit message.
 * @param {string} commitMessage - The commit message text.
 * @returns {Promise<string>} The generated summary.
 */
async function summarizeCommitMessage(commitMessage) {
  const OpenAI = require('openai');
  const openai = new OpenAI(OPENAI_API_KEY);
  const prompt = `Explain the following commit message in a few words (less than 20 words) for a non-technical person. Include the fully summarized message, not just the first few words. Also don't include any filler words:\n\n"${commitMessage}"\n\nSummary:`;

  try {
    const completionResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      max_tokens: 100,
    });

    return completionResponse.choices[0].message.content.trim() || "No summary available.";
  } catch (err) {
    console.error("Error summarizing commit message:", err);
    return "No summary available.";
  }
}

/**
 * Generate a nontechnical summary for a commit diff.
 * @param {string} diff - The commit diff text.
 * @returns {Promise<string>} The generated summary.
 */
async function summarizeCommitDiff(diff) {
  const OpenAI = require('openai');
  const openai = new OpenAI(OPENAI_API_KEY);
  const prompt = `Summarize the following commit diff in simple, nontechnical language suitable for a manager, highlighting the key improvements or changes:\n\n${diff}\n\nSummary:`;

  try {
    const completionResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    return completionResponse.choices[0].message.content.trim() || "Summary not available.";
  } catch (err) {
    console.error("Error summarizing diff:", err);
    return "Summary not available.";
  }
}

/**
 * Extract technologies for a contributor based on their GitHub bio and repo data.
 * @param {string} author - The contributor's GitHub username.
 * @returns {Promise<string[]>} An array of technologies.
 */
async function getTechnologiesForContributor(author) {
  const { Octokit } = await import('@octokit/rest');
  const octokit = new Octokit({ auth: GITHUB_TOKEN || undefined });
  const OpenAI = require('openai');
  const openai = new OpenAI(OPENAI_API_KEY);

  try {
    // Fetch contributor profile
    const userResponse = await octokit.rest.users.getByUsername({ username: author });
    const bio = userResponse.data.bio || "";

    // Fetch contributor repositories (sorted by stargazers_count)
    const reposResponse = await octokit.rest.repos.listForUser({
      username: author,
      sort: "stargazers_count",
      per_page: 5,
    });

    let repoInfo = "";
    if (reposResponse.data && reposResponse.data.length > 0) {
      const topRepo = reposResponse.data[0];
      const languagesResponse = await octokit.rest.repos.listLanguages({
        owner: author,
        repo: topRepo.name,
      });
      const languages = Object.keys(languagesResponse.data).join(", ");
      repoInfo = `Repository: ${topRepo.name}. Languages: ${languages}.`;
    }

    const prompt = `Based on the following GitHub bio and repository information, list the technologies this person appears proficient in. Return your answer as a comma-separated list.\n\nGitHub Bio: ${bio}\nContributor Repository Info: ${repoInfo}\n\nTechnologies:`;

    const completionResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      max_tokens: 50,
    });

    return completionResponse.choices[0].message.content.trim().split(",").map(t => t.trim()).filter(Boolean);
  } catch (err) {
    console.error(`Error fetching technologies for ${author}:`, err);
    return [];
  }
}

/**
 * Update the company record's nice_data column by transforming scraped_data.
 * For each commit in each repository, replace the full diff with a short nontechnical summary.
 * Also, create a new field 'people' listing unique commit authors with their full name and a list of technologies.
 * @param {string} companyId - The company ID to update.
 */
async function updateNiceData(companyId) {
  const { data: company, error } = await supabase
    .from('data')
    .select('*')
    .eq('id', parseInt(companyId))
    .single();

  if (error || !company) {
    console.error("Error fetching company data:", error);
    return;
  }

  const scrapedData = company.scraped_data;
  if (!scrapedData || !Array.isArray(scrapedData)) {
    console.error("No scraped_data available in the company record.");
    return;
  }

  const niceData = [];
  for (const repo of scrapedData) {
    const newRepo = {
      name: repo.name,
      link: repo.link,
      stars: repo.stars,
      top50contributors: repo.top50contributors,
      commits: [],
      averageAdditions: repo.averageAdditions,
      averageDeletions: repo.averageDeletions,
      people: []
    };

    // Process each commit: summarize the diff and message
    if (repo.commits && Array.isArray(repo.commits)) {
      for (const commit of repo.commits) {
        const summary = commit.diff ? await summarizeCommitDiff(commit.diff) : "No diff available.";
        const messageSummary = commit.message ? await summarizeCommitMessage(commit.message) : "No message available.";

        newRepo.commits.push({
          message: commit.message,
          messageSummary: messageSummary,
          author: commit.author,
          summary: summary,
          stats: commit.stats,
        });
      }
    }

    // Process unique commit authors
    const uniqueAuthors = new Set(repo.commits.map(commit => commit.author));

    for (const author of uniqueAuthors) {
      try {
        const techList = await getTechnologiesForContributor(author);
        const { Octokit } = await import('@octokit/rest');
        const octokit = new Octokit({ auth: GITHUB_TOKEN || undefined });
        const userResponse = await octokit.rest.users.getByUsername({ username: author });
        const fullName = userResponse.data.name || author;

        newRepo.people.push({
          username: author,
          name: fullName,
          technologies: techList,
        });
      } catch (err) {
        console.error(`Error processing contributor ${author}:`, err);
        newRepo.people.push({
          username: author,
          technologies: [],
        });
      }
    }

    niceData.push(newRepo);
  }

  console.log("Nice Data Summary:");
  console.log(JSON.stringify(niceData, null, 2));

  const { error: updateError } = await supabase
    .from('data')
    .update({ nice_data: niceData })
    .eq('id', parseInt(companyId));

  if (updateError) {
    console.error("Error updating company record with nice_data:", updateError);
  } else {
    console.log("Successfully updated company record with nice_data.");
  }
}

const companyId = process.argv[2];
if (!companyId) {
  console.error('Usage: node updateNiceData.js <companyId>');
  process.exit(1);
}

updateNiceData(companyId);
