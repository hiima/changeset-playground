#!/usr/bin/env node

import { execSync } from "child_process";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..", "..");

function getPrDiff(prNumber) {
	try {
		const diff = execSync(`gh pr diff ${prNumber}`, {
			cwd: rootDir,
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "inherit"],
		});
		return diff;
	} catch (error) {
		console.error("Failed to get PR diff:", error.message);
		process.exit(1);
	}
}

function parsePackageVersionChanges(diff) {
	const changes = [];
	const lines = diff.split("\n");

	let currentFile = null;
	let removedVersion = null;

	for (const line of lines) {
		const fileMatch = line.match(
			/^diff --git a\/(packages\/[^/]+\/package\.json)/,
		);
		if (fileMatch) {
			currentFile = fileMatch[1];
			removedVersion = null;
			continue;
		}

		if (currentFile) {
			const removedMatch = line.match(/^-\s*"version":\s*"([^"]+)"/);
			if (removedMatch) {
				removedVersion = removedMatch[1];
				continue;
			}

			const addedMatch = line.match(/^\+\s*"version":\s*"([^"]+)"/);
			if (addedMatch && removedVersion) {
				const newVersion = addedMatch[1];
				const packageDir = dirname(currentFile);

				const packageJsonPath = join(rootDir, currentFile);
				const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));

				changes.push({
					name: packageJson.name,
					version: newVersion,
					packageDir: packageDir,
				});

				currentFile = null;
				removedVersion = null;
			}
		}
	}

	return changes;
}

function extractChangelogEntry(changelogContent, version) {
	const lines = changelogContent.split("\n");
	let inTargetSection = false;
	const entry = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		const versionHeaderMatch = line.match(/^##\s+(.+)$/);
		if (versionHeaderMatch) {
			const header = versionHeaderMatch[1].trim();

			if (header === version || header.startsWith(`${version} `)) {
				inTargetSection = true;
				continue;
			}

			if (inTargetSection) {
				break;
			}
		}

		if (inTargetSection) {
			entry.push(line);
		}
	}

	return entry.join("\n").trim();
}

function detectReleases(prNumber) {
	const diff = getPrDiff(prNumber);
	const packageChanges = parsePackageVersionChanges(diff);

	const releases = packageChanges.map((change) => {
		const changelogPath = join(rootDir, change.packageDir, "CHANGELOG.md");

		let changelog = "";
		try {
			const changelogContent = readFileSync(changelogPath, "utf-8");
			changelog = extractChangelogEntry(changelogContent, change.version);
		} catch (error) {
			console.error(
				`Warning: Could not read CHANGELOG.md for ${change.name}:`,
				error.message,
			);
		}

		return {
			name: change.name,
			version: change.version,
			changelog: changelog,
		};
	});

	return releases;
}

function main() {
	const prNumber = process.argv[2];

	if (!prNumber) {
		console.error("Usage: node detect-releases.js <pr-number>");
		process.exit(1);
	}

	const releases = detectReleases(prNumber);
	console.log(JSON.stringify(releases, null, 2));
}

main();
