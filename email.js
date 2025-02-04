// email.js

// Load environment variables from .env file
const dotenv = require('dotenv');
dotenv.config();

const { createClient } = require('@supabase/supabase-js');

// Retrieve credentials from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;  // (not used in this file)
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
 * Summarize the scraped GitHub data by selecting the top repository (by stars)
 * and including the diffs from its 3 most recent commits plus average code churn.
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
    commitsToInclude.forEach((commit, index) => {
      // Truncate diff for brevity
      const diffExcerpt = commit.diff.slice(0, 200).replace(/\n/g, ' ');
      summary += `Commit ${index + 1} by ${commit.author}:\n${diffExcerpt}...\n\n`;
    });
  }
  
  if (topRepo.averageAdditions !== undefined && topRepo.averageDeletions !== undefined) {
    summary += `Average changes per commit: +${topRepo.averageAdditions} lines, -${topRepo.averageDeletions} lines.\n`;
  }
  
  return summary;
}

/**
 * Generate a personalized email using OpenAI's API.
 * This function dynamically imports the OpenAI module and uses the old API.
 * @param {Object} company - The company data (including scraped_data and personalization fields).
 * @returns {Promise<string>} The generated email content.
 */
async function generateEmail(company) {
  // Use the older API by requiring the package directly.
  const OpenAI = require('openai');
  const openai = new OpenAI(OPENAI_API_KEY);

  // Create a summary of the scraped GitHub data.
  const dataSummary = summarizeScrapedData(company.scraped_data);

  // Construct a concise, personable prompt.
  const prompt = `
You are a friendly email copywriter who translates technical commit diffs and code metrics into clear, actionable insights for nontechnical managers.

Write a concise email that tells a short story. For example, your email might say:

"I noticed that last week your top repository, [Repo Name], received important updates—especially in areas like authentication and UI improvements. This indicates that your team is making significant progress.

Key insights:
- [Author 1]'s commits added impressive improvements (averaging +[avgAdditions] lines and -[avgDeletions] lines per commit).
- [Author 2] contributed meaningful fixes that enhance stability.
- [Author 3] made critical updates that boost overall quality.

These automated insights help managers quickly understand technical progress. Check out odem.ai and let's schedule a call to see if our AI Manager Assistant can benefit your company."

Now, fill in the following:
- Company Name: ${company.name}
- Manager Name: ${company.manager_name || '[Manager Name]'}
- GitHub Data Summary:
${dataSummary}

Generate a complete email (just the body, no subject) that replaces all placeholders with the appropriate information, provides clear and engaging insights, and ends with a call to action.
`;

  const completionResponse = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
  });

  const emailContent = completionResponse.choices[0].message.content;
  return emailContent || "";
}

/**
 * Main function to process the email for a given company ID.
 * @param {string} companyId - The identifier for the company to process.
 */
async function main(companyId) {
  try {
    // Fetch company data from Supabase (this script no longer makes any GitHub API calls)
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

    // Log the scraped GitHub data (which now includes averageAdditions and averageDeletions, etc.)
    console.log("Scraped GitHub Data:", JSON.stringify(data.scraped_data, null, 2));

    // Generate the personalized email using the scraped data and company info.
    const email = await generateEmail(data);
    console.log("\n--- Generated Email ---\n");
    console.log(email);

    // Optionally, update the company record with the generated email.
    const { error: updateError } = await supabase
      .from('data')
      .update({ email: email })
      .eq('id', parseInt(companyId));
    if (updateError) {
      console.error('Error updating company record with generated email:', updateError);
    } else {
      console.log('Successfully updated company record with generated email.');
    }

  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

// Retrieve the company ID from the command-line arguments.
const companyId = process.argv[2];
if (!companyId) {
  console.error('Usage: node email.js <companyId>');
  process.exit(1);
}

// Run the main function with the provided company ID.
main(companyId);
