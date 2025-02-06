// run all the scripts in the right order with the given argument 

const args = process.argv.slice(2);
const companyId = args[0];

if (!companyId) {
  console.error("Please provide a company ID as an argument.");
  process.exit(1);
}

// run the scripts in the right order

// 1. scrape the company - npm run scrape
// 2. email the company - npm run email
// 3. update the nice data - npm run nice

const { execSync } = require('child_process');

try {
  console.log("Starting scrape...");
  execSync(`npm run scrape -- ${companyId}`, { stdio: 'inherit' });

  console.log("Sending emails...");
  execSync(`npm run email -- ${companyId}`, { stdio: 'inherit' });

  console.log("Updating nice data...");
  execSync(`npm run nice -- ${companyId}`, { stdio: 'inherit' });

  console.log("All scripts executed successfully.");
} catch (error) {
  console.error("An error occurred while executing the scripts:", error);
  process.exit(1);
}



