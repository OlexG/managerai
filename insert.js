// insert.js

// 1. Load environment variables from .env file
const dotenv = require('dotenv');
dotenv.config();

const { createClient } = require('@supabase/supabase-js');

// 2. Retrieve Supabase credentials from environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Error: Missing Supabase credentials. Please check your .env file.');
  process.exit(1);
}

// 3. Initialize the Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 4. Define the list of companies, starting at ID 101
const companies = [
  { id: 103, name: 'OpenKM',     website: 'https://github.com/openkm' },
  { id: 104, name: 'dotCMS',     website: 'https://github.com/dotCMS' },
  { id: 105, name: 'Databricks', website: 'https://github.com/databricks' },
  { id: 106, name: 'Confluent',  website: 'https://github.com/confluentinc' },
  { id: 107, name: 'Elastic',    website: 'https://github.com/elastic/' },
  { id: 108, name: 'Hashicorp',  website: 'https://github.com/hashicorp' },
  { id: 109, name: 'Akka',       website: 'https://github.com/akka' },
  { id: 110, name: 'camunda',    website: 'https://github.com/camunda' },
  { id: 111, name: 'Graylog',    website: 'https://github.com/Graylog2' },
];

// 5. Main function to run the insert
async function main() {
  try {
    // Insert all entries at once
    const { data, error } = await supabase
      .from('data')
      .insert(companies);

    if (error) {
      console.error('Error inserting data:', error);
    } else {
      console.log('Successfully inserted rows:', data);
    }
  } catch (err) {
    console.error('Unexpected error:', err);
  }
}

// 6. Run the script
main();
