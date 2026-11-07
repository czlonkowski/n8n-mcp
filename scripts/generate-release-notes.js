#!/usr/bin/env node

/**
 * Generate release notes from commit messages between two tags
 * Used by GitHub Actions to create automated release notes
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function generateReleaseNotes(previousTag, currentTag) {
  try {
    console.log(`Generating release notes from ${previousTag} to ${currentTag}`);

    // Get commits between tags
    // Arguments are passed as a list, so a tag name is never parsed by a shell.
    const commitsOutput = execFileSync(
      'git',
      ['log', '--pretty=format:%H|%s|%an|%ae|%ad', '--date=short', '--no-merges', `${previousTag}..${currentTag}`],
      { encoding: 'utf8' }
    );

    if (!commitsOutput.trim()) {
      console.log('No commits found between tags');
      return 'No changes in this release.';
    }

    const commits = commitsOutput.trim().split('\n').map(line => {
      const [hash, subject, author, email, date] = line.split('|');
      return { hash, subject, author, email, date };
    });

    // Categorize commits
    const categories = {
      'feat': { title: '✨ Features', commits: [] },
      'fix': { title: '🐛 Bug Fixes', commits: [] },
      'docs': { title: '📚 Documentation', commits: [] },
      'refactor': { title: '♻️ Refactoring', commits: [] },
      'test': { title: '🧪 Testing', commits: [] },
      'perf': { title: '⚡ Performance', commits: [] },
      'style': { title: '💅 Styling', commits: [] },
      'ci': { title: '🔧 CI/CD', commits: [] },
      'build': { title: '📦 Build', commits: [] },
      'chore': { title: '🔧 Maintenance', commits: [] },
      'other': { title: '📝 Other Changes', commits: [] }
    };

    commits.forEach(commit => {
      const subject = commit.subject.toLowerCase();
      let categorized = false;

      // Check for conventional commit prefixes
      for (const [prefix, category] of Object.entries(categories)) {
        if (prefix !== 'other' && subject.startsWith(`${prefix}:`)) {
          category.commits.push(commit);
          categorized = true;
          break;
        }
      }

      // If not categorized, put in other
      if (!categorized) {
        categories.other.commits.push(commit);
      }
    });

    // Generate release notes
    const releaseNotes = [];

    for (const [key, category] of Object.entries(categories)) {
      if (category.commits.length > 0) {
        releaseNotes.push(`### ${category.title}`);
        releaseNotes.push('');

        category.commits.forEach(commit => {
          // Clean up the subject by removing the prefix if it exists
          let cleanSubject = commit.subject;
          const colonIndex = cleanSubject.indexOf(':');
          if (colonIndex !== -1 && cleanSubject.substring(0, colonIndex).match(/^(feat|fix|docs|refactor|test|perf|style|ci|build|chore)$/)) {
            cleanSubject = cleanSubject.substring(colonIndex + 1).trim();
            // Capitalize first letter
            cleanSubject = cleanSubject.charAt(0).toUpperCase() + cleanSubject.slice(1);
          }

          releaseNotes.push(`- ${cleanSubject} (${commit.hash.substring(0, 7)})`);
        });

        releaseNotes.push('');
      }
    }

    // Add commit statistics
    const totalCommits = commits.length;
    const contributors = [...new Set(commits.map(c => c.author))];

    releaseNotes.push('---');
    releaseNotes.push('');
    releaseNotes.push(`**Release Statistics:**`);
    releaseNotes.push(`- ${totalCommits} commit${totalCommits !== 1 ? 's' : ''}`);
    releaseNotes.push(`- ${contributors.length} contributor${contributors.length !== 1 ? 's' : ''}`);

    if (contributors.length <= 5) {
      releaseNotes.push(`- Contributors: ${contributors.join(', ')}`);
    }

    return releaseNotes.join('\n');

  } catch (error) {
    console.error(`Error generating release notes: ${error.message}`);
    return `Failed to generate release notes: ${error.message}`;
  }
}

// Parse command line arguments
const previousTag = process.argv[2];
const currentTag = process.argv[3];

if (!previousTag || !currentTag) {
  console.error('Usage: generate-release-notes.js <previous-tag> <current-tag>');
  process.exit(1);
}

const releaseNotes = generateReleaseNotes(previousTag, currentTag);
console.log(releaseNotes);
