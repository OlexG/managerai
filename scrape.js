// scrape.js

// Load environment variables from .env file
const dotenv = require('dotenv');
dotenv.config();

const { createClient } = require('@supabase/supabase-js');

// Retrieve credentials from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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
 * Summarize the scraped GitHub data by selecting the top repository (by stars),
 * including the diffs from its 3 most recent commits and computing average additions/deletions.
 * @param {Array} scrapedData - Array of repository objects.
 * @returns {string} A summary string.
 */
function summarizeScrapedData(scrapedData) {
  if (!scrapedData || !Array.isArray(scrapedData) || scrapedData.length === 0) {
    return 'No repository data available.';
  }

  // Sort repositories by stars descending and choose the top one.
  const sortedRepos = scrapedData.sort((a, b) => b.stars - a.stars);
  const topRepo = sortedRepos[0];

  let summary = `Top Repository:\n`;
  summary += `Name: ${topRepo.name}\nStars: ${topRepo.stars}\nLink: ${topRepo.link}\n\n`;

  if (topRepo.commits && topRepo.commits.length > 0) {
    summary += `Top 3 Recent Commits:\n`;
    const commitsToInclude = topRepo.commits.slice(0, 3);
    let totalAdditions = 0;
    let totalDeletions = 0;
    let countStats = 0;
    commitsToInclude.forEach((commit, index) => {
      // Truncate diff for brevity (adjust length as needed)
      const diffExcerpt = commit.diff.slice(0, 200).replace(/\n/g, ' ');
      summary += `Commit ${index + 1} by ${commit.author}:\n${diffExcerpt}...\n\n`;
      if (commit.stats) {
        totalAdditions += commit.stats.additions;
        totalDeletions += commit.stats.deletions;
        countStats++;
      }
    });
    if (countStats > 0) {
      const avgAdditions = Math.round(totalAdditions / countStats);
      const avgDeletions = Math.round(totalDeletions / countStats);
      summary += `Average changes per commit: +${avgAdditions} lines, -${avgDeletions} lines.\n`;
    }
  }
  return summary;
}

/**
 * Main function to scrape GitHub data for a given company ID.
 * @param {string} companyId - The identifier for the company to process.
 */
async function main(companyId) {
  try {
    // Dynamically import Octokit (since it's an ES module)
    const { Octokit } = await import('@octokit/rest');

    // Fetch company data from Supabase
    const { data, error } = await supabase
      .from('data')
      .select('*')
      .eq('id', parseInt(companyId))
      .single();

    console.log("Help");
    console.log(data, error);
    if (error) {
      console.error('Error fetching company data:', error);
      return;
    }
    if (!data) {
      console.error('No company data found.');
      return;
    }

    // Parse the website URL to extract the GitHub organization name.
    const website = data.website;
    console.log(`Company website: ${website}`);
    let orgName;
    try {
      const url = new URL(website);
      const pathParts = url.pathname.split('/').filter(Boolean);
      if (pathParts.length < 1) {
        throw new Error('Invalid URL path. Could not extract organization name.');
      }
      orgName = pathParts[0];
    } catch (parseError) {
      console.error('Error parsing GitHub URL:', parseError);
      return;
    }
    console.log(`Parsed GitHub organization: ${orgName}`);

    // Initialize Octokit with the GitHub token.
    const octokit = new Octokit({
      auth: GITHUB_TOKEN || undefined,
    });

    // Fetch all public repositories for the organization.
    console.log(`Fetching repositories for organization ${orgName}...`);
    const reposResponse = await octokit.rest.repos.listForOrg({
      org: orgName,
      type: 'public',
      per_page: 100,
    });
    const repos = reposResponse.data;

    // Sort repositories by stargazers_count descending and select the top 1.
    const sortedRepos = repos.sort((a, b) => b.stargazers_count - a.stargazers_count);
    const topRepos = sortedRepos.slice(0, 1);
    console.log(`Selected top ${topRepos.length} repository for ${orgName}.`);

    // Create an array to hold the final scraped data.
    const results = [];

    // For each top repository, gather detailed information.
    for (const repo of topRepos) {
      console.log(`\nProcessing repository: ${repo.name}`);

      // Get the top 50 contributors.
      let contributors = [];
      try {
        const contributorsResponse = await octokit.rest.repos.listContributors({
          owner: orgName,
          repo: repo.name,
          per_page: 50,
        });
        // Instead of storing usernames, fetch each contributor's profile to get their full name.
        const contributorProfiles = await Promise.all(
          contributorsResponse.data.map(async (contributor) => {
            try {
              const userResponse = await octokit.rest.users.getByUsername({
                username: contributor.login,
              });
              const fullName = userResponse.data.name;
              return fullName ? fullName : contributor.login;
            } catch (err) {
              console.error(`Error fetching profile for ${contributor.login}:`, err);
              return contributor.login;
            }
          })
        );
        contributors = contributorProfiles;
      } catch (contribError) {
        console.error(`Error fetching contributors for repository ${repo.name}:`, contribError);
      }

      // Get the 10 most recent commits for this repository.
      let commitsData = [];
      try {
        const commitsResponse = await octokit.rest.repos.listCommits({
          owner: orgName,
          repo: repo.name,
          per_page: 10,
        });
        const commitSummaries = commitsResponse.data;

        // Process each commit to get detailed diff info.
        for (const commitSummary of commitSummaries) {
          const commitSha = commitSummary.sha;
          try {
            const commitDetailsResponse = await octokit.rest.repos.getCommit({
              owner: orgName,
              repo: repo.name,
              ref: commitSha,
            });
            const commitDetails = commitDetailsResponse.data;

            const commitAuthor =
              commitDetails.author?.login ||
              commitDetails.commit.author?.name ||
              'Unknown';
            const commitMessage = commitDetails.commit.message;
            let diffText = '';
            if (commitDetails.files && commitDetails.files.length > 0) {
              diffText = commitDetails.files
                .map((file) => {
                  if (file.patch) {
                    return `File: ${file.filename}\n${file.patch}\n`;
                  }
                  return `File: ${file.filename} (no patch available)\n`;
                })
                .join('\n');
            } else {
              diffText = 'No file changes found for this commit.';
            }
            
            // Include commit stats if available
            const stats = commitDetails.stats || { additions: 0, deletions: 0, total: 0 };

            commitsData.push({
              message: commitMessage,
              author: commitAuthor,
              diff: diffText,
              stats: stats
            });
          } catch (commitDetailError) {
            console.error(`Error fetching details for commit ${commitSha} in repo ${repo.name}:`, commitDetailError);
          }
        }
      } catch (commitError) {
        console.error(`Error fetching commits for repository ${repo.name}:`, commitError);
      }

      // Calculate average additions and deletions for the top 3 commits (if available)
      let totalAdditions = 0;
      let totalDeletions = 0;
      let countStats = 0;
      const top3Commits = commitsData.slice(0, 3);
      top3Commits.forEach((commit) => {
        if (commit.stats) {
          totalAdditions += commit.stats.additions;
          totalDeletions += commit.stats.deletions;
          countStats++;
        }
      });
      const averageAdditions = countStats > 0 ? Math.round(totalAdditions / countStats) : 0;
      const averageDeletions = countStats > 0 ? Math.round(totalDeletions / countStats) : 0;

      const repoData = {
        name: repo.name,
        link: repo.html_url,
        stars: repo.stargazers_count,
        top50contributors: contributors,
        commits: commitsData,
        averageAdditions,
        averageDeletions
      };

      results.push(repoData);
    }

    console.log('\nFinal scraped data:');
    console.log(JSON.stringify(results, null, 2));

    // Update the company's record in Supabase with the scraped data.
    const { error: updateError } = await supabase
      .from('data')
      .update({ scraped_data: results })
      .eq('id', parseInt(companyId));

    if (updateError) {
      console.error('Error updating company record with scraped data:', updateError);
    } else {
      console.log('Successfully updated company record with scraped data.');
    }
    
  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

// Retrieve the company ID from the command-line arguments.
const companyId = process.argv[2];
if (!companyId) {
  console.error('Usage: node scrape.js <companyId>');
  process.exit(1);
}

// Run the main function with the provided company ID.
main(companyId);
