import { readFileSync, writeFileSync } from 'fs';

const content = readFileSync('/Users/temitope/.gemini/antigravity-cli/brain/56197ba6-c4e0-410a-a3b8-5b0f93947f86/.system_generated/steps/42/content.md', 'utf-8');

// Strip HTML tags using simple regex
let text = content
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<[^>]+>/g, ' ');

// Decode some basic HTML entities
text = text
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'");

// Clean up whitespace
const lines = text
  .split('\n')
  .map(line => line.trim())
  .filter(line => line.length > 0);

writeFileSync('jds/spotify.md', lines.join('\n'), 'utf-8');
console.log('JD text written to jds/spotify.md');
