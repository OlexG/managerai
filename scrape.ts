// scrape.ts

// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { Octokit } from '@octokit/rest';

// Define TypeScript interfaces for our output data.
interface CommitData {
  author: string;
  diff: string;
}

interface RepoData {
  name: string;
  link: string;
  stars: number;
  top50contributors: string[];
  commits: CommitData[];
}

// Retrieve Supabase credentials from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Error: Missing Supabase credentials. Please check your .env file.');
  process.exit(1);
}

// Initialize the Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Main function to process scraping for a given company ID.
 * @param companyId - The identifier for the company to scrape.
 */
async function main(companyId: string): Promise<void> {
  try {
    // Fetch company data from Supabase
    const { data, error } = await supabase
      .from('data')
      .select('*')
      .eq('id', parseInt(companyId))
      .single();

    if (error) {
      console.error('Error fetching company data:', error);
      return;
    }

    // Get the website URL (expected to be a GitHub org URL, e.g., https://github.com/PostHog)
    const website: string = data.website;
    console.log(`Company website: ${website}`);

    // Parse the GitHub organization name from the website URL.
    let orgName: string;
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

    // Initialize Octokit with the optional GitHub token.
    const octokit = new Octokit({
      auth: GITHUB_TOKEN || undefined,
    });

    // Fetch all public repositories for the organization.
    console.log(`Fetching repositories for organization ${orgName}...`);
    const reposResponse = await octokit.rest.repos.listForOrg({
      org: orgName,
      type: 'public',
      per_page: 100, // adjust if needed; may require pagination for very large orgs
    });
    const repos = reposResponse.data;

    // Sort repositories by stargazers_count in descending order.
    const sortedRepos = repos.sort((a, b) => b.stargazers_count - a.stargazers_count);
    // Take the top 4 repositories.
    const topRepos = sortedRepos.slice(0, 4);
    console.log(`Selected top ${topRepos.length} repositories for ${orgName}.`);

    // Create an array to hold the final data.
    const results: RepoData[] = [];

    // For each top repository, gather detailed information.
    for (const repo of topRepos) {
      console.log(`\nProcessing repository: ${repo.name}`);

      // Get the top 50 contributors (GitHub returns them sorted by contributions)
      let contributors: string[] = [];
      try {
        const contributorsResponse = await octokit.rest.repos.listContributors({
          owner: orgName,
          repo: repo.name,
          per_page: 50,
        });
        contributors = contributorsResponse.data.map((contributor) => contributor.login);
      } catch (contribError) {
        console.error(`Error fetching contributors for repository ${repo.name}:`, contribError);
      }

      // Get the 10 most recent commits for this repository.
      let commitsData: CommitData[] = [];
      try {
        const commitsResponse = await octokit.rest.repos.listCommits({
          owner: orgName,
          repo: repo.name,
          per_page: 10,
        });
        const commitSummaries = commitsResponse.data;

        // Process each commit to get its detailed diff info.
        for (const commitSummary of commitSummaries) {
          const commitSha = commitSummary.sha;
          try {
            const commitDetailsResponse = await octokit.rest.repos.getCommit({
              owner: orgName,
              repo: repo.name,
              ref: commitSha,
            });
            const commitDetails = commitDetailsResponse.data;

            // Determine the commit author's username (or fallback to the commit author's name)
            const commitAuthor =
              commitDetails.author?.login ||
              commitDetails.commit.author?.name ||
              'Unknown';

            // Aggregate the diffs from all changed files into a single diff string.
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

            commitsData.push({
              author: commitAuthor,
              diff: diffText,
            });
          } catch (commitDetailError) {
            console.error(`Error fetching details for commit ${commitSha} in repo ${repo.name}:`, commitDetailError);
          }
        }
      } catch (commitError) {
        console.error(`Error fetching commits for repository ${repo.name}:`, commitError);
      }

      // Assemble our repository data object.
      const repoData: RepoData = {
        name: repo.name,
        link: repo.html_url,
        stars: repo.stargazers_count,
        top50contributors: contributors,
        commits: commitsData,
      };

      results.push(repoData);
    }

    // Now `results` contains the array of repository objects with the desired structure.
    console.log('\nFinal scraped data:');
    console.log(JSON.stringify(results, null, 2));

    // Update the company's record in Supabase with the scraped data in the "scraped_data" JSONB column.
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
  console.error('Usage: ts-node scrape.ts <companyId>');
  process.exit(1);
}

// Run the main function with the provided company ID.
main(companyId);
