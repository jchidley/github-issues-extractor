/**
 * Simplified TypeScript GitHub Issues Extractor
 * npm install sqlite3 @types/sqlite3
 */

import * as https from 'https';
import * as sqlite3 from 'sqlite3';

// Parse command line args
const [owner, repo, token, dbPath = `${owner}-${repo}.db`] = process.argv.slice(2);

if (!owner || !repo || !token) {
  console.log('Usage: node script.js owner repo token [dbname]');
  process.exit(1);
}

console.log(`Using database: ${dbPath}`);

// Initialize database
const db = new sqlite3.Database(dbPath);

// Fetch data from GitHub API
const fetchGitHub = (path: string): Promise<any> => 
  new Promise(resolve => {
    https.get({
      hostname: 'api.github.com',
      path,
      headers: {
        'User-Agent': 'GitHub-Issues-Extractor',
        'Authorization': `token ${token}`
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
  });

// Run a SQL query and return a promise
const dbRun = (sql: string): Promise<void> => 
  new Promise((resolve, reject) => {
    db.run(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });

// Main function
async function main(): Promise<void> {
  let issueStmt: sqlite3.Statement | null = null;
  let commentStmt: sqlite3.Statement | null = null;
  let commentUpdateStmt: sqlite3.Statement | null = null;
  const stats = { processedIssues: 0, newIssues: 0, newComments: 0, updatedComments: 0 };
  
  try {
    // 1. Setup database tables
    const hasIssuesTable = await new Promise<boolean>(r => 
      db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='issues'", (_, row) => r(!!row))
    );
    
    const hasCommentsTable = await new Promise<boolean>(r => 
      db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='comments'", (_, row) => r(!!row))
    );
    
    if (!hasIssuesTable || !hasCommentsTable) {
      await dbRun('DROP TABLE IF EXISTS issues');
      await dbRun('DROP TABLE IF EXISTS comments');
      await dbRun('CREATE TABLE issues (id INT PRIMARY KEY, number INT, title TEXT, body TEXT, updated_at TEXT)');
      await dbRun('CREATE TABLE comments (id INT PRIMARY KEY, issue_id INT, body TEXT, updated_at TEXT)');
      console.log('Created new database');
    } else {
      // Check and add updated_at columns if needed
      let schemaUpdated = false;
      
      for (const table of ['issues', 'comments']) {
        const cols = await new Promise<any[]>(r => 
          db.all(`PRAGMA table_info(${table})`, (_, cols) => r(cols || []))
        );
        
        if (!cols.some(col => col.name === 'updated_at')) {
          await dbRun(`ALTER TABLE ${table} ADD COLUMN updated_at TEXT`);
          schemaUpdated = true;
        }
      }
      
      console.log(schemaUpdated ? 'Updated database schema' : 'Using existing database');
    }
    
    // 2. Get highest issue number
    const startIssue = await new Promise<number>(r => 
      db.get("SELECT MAX(number) as max FROM issues", (_, row: any) => 
        r((row && row.max) ? row.max : 0)
      )
    );
    console.log(`Starting from issue #${startIssue}`);
    
    // 3. Prepare statements
    issueStmt = db.prepare('INSERT OR IGNORE INTO issues VALUES (?,?,?,?,?)');
    commentStmt = db.prepare('INSERT OR IGNORE INTO comments VALUES (?,?,?,?)');
    commentUpdateStmt = db.prepare('UPDATE comments SET body=?, updated_at=? WHERE id=?');
    
    // 4. Process new issues
    let page = 1;
    let continueProcessing = true;
    
    while (continueProcessing) {
      const issues = await fetchGitHub(`/repos/${owner}/${repo}/issues?state=all&page=${page++}&per_page=100&sort=created&direction=asc`);
      
      if (issues.length === 0) break;
      
      console.log(`Processing issues page ${page-1}`);
      continueProcessing = false;
      
      for (const issue of issues) {
        stats.processedIssues++;
        
        if (issue.number <= startIssue) continue;
        
        continueProcessing = true;
        stats.newIssues++;
        
        // Save issue
        issueStmt.run(issue.id, issue.number, issue.title, issue.body || '', issue.updated_at);
        
        // Get and save comments
        if (issue.comments > 0) {
          const comments = await fetchGitHub(`/repos/${owner}/${repo}/issues/${issue.number}/comments`);
          
          for (const comment of comments) {
            commentStmt.run(comment.id, issue.id, comment.body || '', comment.updated_at);
            stats.newComments++;
          }
        }
      }
      
      if (!continueProcessing && issues.length < 100) break;
    }
    
    // 5. Check for comment updates on existing issues
    if (startIssue > 0) {
      console.log('Checking for updates to existing issues...');
      
      const existingIssues = await new Promise<any[]>(r => 
        db.all("SELECT id, number FROM issues WHERE number <= ?", [startIssue], (_, rows) => 
          r(rows || [])
        )
      );
      
      for (const issue of existingIssues) {
        stats.processedIssues++;
        
        // Get existing comments
        const commentMap: Record<number, { body: string, updated_at: string }> = {};
        await new Promise<void>(r => 
          db.all("SELECT id, body, updated_at FROM comments WHERE issue_id = ?", [issue.id], (_, rows: any) => {
            if (rows) rows.forEach((row: any) => {
              commentMap[row.id] = { body: row.body, updated_at: row.updated_at };
            });
            r();
          })
        );
        
        // Get current comments from GitHub
        const comments = await fetchGitHub(`/repos/${owner}/${repo}/issues/${issue.number}/comments`);
        
        // Check for new or updated comments
        for (const comment of comments) {
          if (!commentMap[comment.id]) {
            // New comment on existing issue
            commentStmt.run(comment.id, issue.id, comment.body || '', comment.updated_at);
            stats.newComments++;
          } else if (
            commentMap[comment.id].body !== comment.body || 
            commentMap[comment.id].updated_at !== comment.updated_at
          ) {
            // Updated comment
            commentUpdateStmt.run(comment.body || '', comment.updated_at, comment.id);
            stats.updatedComments++;
          }
        }
      }
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
  } finally {
    // Finalize statements
    if (issueStmt) issueStmt.finalize();
    if (commentStmt) commentStmt.finalize();
    if (commentUpdateStmt) commentUpdateStmt.finalize();
    
    console.log(`Done! Processed ${stats.processedIssues} issues.`);
    console.log(`Added ${stats.newIssues} new issues.`);
    console.log(`Added ${stats.newComments} new comments.`);
    console.log(`Updated ${stats.updatedComments} existing comments.`);
    
    // Close database with delay to ensure statements are finalized
    setTimeout(() => db.close(), 100);
  }
}

// Run the program
main();
