#!/usr/bin/env node
/**
 * Checks the skills against the libraries they teach.
 *
 * Two layers:
 *
 * 1. Structure (no dependencies): required sections exist, every in-page anchor
 *    resolves to a heading, code fences are balanced, and no fixed-delay
 *    read-after-write guidance survives outside the anti-pattern section.
 * 2. API drift (needs the packages): every library symbol the skills reference is
 *    still exported by the installed typings. When the packages are not installed
 *    this layer is skipped with a warning, so the structure checks stay useful.
 *
 * Usage:
 *   node scripts/check-skills.mjs                       # structure, plus drift if installed
 *   node scripts/check-skills.mjs --modules=<dir>       # resolve packages from another node_modules
 *   node scripts/check-skills.mjs --strict              # missing packages are a failure
 *   node scripts/check-skills.mjs --check-installed     # also diff against ~/.agents/skills
 *
 * Exit codes: 0 ok, 1 problems.
 */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
	const match = args.find((arg) => arg.startsWith(`--${name}=`));
	return match ? match.slice(name.length + 3) : fallback;
};

const modulesDir = value('modules', repoRoot);
const strict = flag('strict');

// Sections where a timer is the subject (a coalescing flush), not a wait substitute.
const TIMER_SECTIONS = new Set(['batchingbookmark']);

const problems = [];
const warnings = [];
const report = (message) => problems.push(message);

const SKILLS = [
	{
		path: 'skills/evtstore-reference/SKILL.md',
		// The reference is where the helpers are introduced; the quickstart links to it.
		helpers: true,
		required: [
			'projection-integrity',
			'projection-throughput',
			'reading-your-own-writes',
			'operating-projections',
			'shutdown',
			'appendix-a-generic-nodejs-wiring',
			'appendix-b-sveltekit-wiring'
		]
	},
	{
		path: 'skills/evtstore-quickstart/SKILL.md',
		required: ['step-6-wait-for-the-projection-dont-sleep']
	}
];

// Symbols the skills introduce themselves. Each must be defined in a code block or
// listed in the helper table, so no example references a name that does not exist.
const HELPERS = [
	'BatchingBookmark',
	'batchingBookmark',
	'waitForProjection',
	'catchUp',
	'installWriteBuffer',
	'installPositionGuards',
	'flushProjectionWrites',
	'flushAllBookmarks',
	'registerShutdownFlush',
	'registerProjectionHandler',
	'coalescedRun',
	'isDuplicateKey',
	'createProjectionHandler',
	'resolveBookmarks',
	'resolveTarget',
	'persistedPosition',
	'atOrAfter',
	'lastHandlerFailureAtOrAfter',
	'handlerExists'
];

const SYMBOLS = [
	{
		pkg: 'evtstore',
		symbols: [
			'createHandler',
			'createBookmark',
			'createDomain',
			'createAggregate',
			'createCommands',
			'ProviderBookmark',
			'EventMeta',
			'StoreEvent',
			'Provider'
		]
	},
	{ pkg: 'evtstore/provider/mongo', symbols: ['createProvider', 'migrate', 'Bookmark'] },
	{ pkg: 'evtstore/provider/util', symbols: ['createEventsMapper'] },
	{
		pkg: 'mongodb',
		symbols: ['MongoClient', 'Timestamp', 'Collection', 'Filter', 'Document', 'WithId']
	}
];

function slugify(heading) {
	return heading
		.toLowerCase()
		.trim()
		.replace(/[^\w\s-]/g, '')
		.replace(/\s+/g, '-');
}

function checkStructure(skill) {
	const file = join(repoRoot, skill.path);
	if (!existsSync(file)) {
		report(`${skill.path}: missing`);
		return;
	}

	const text = readFileSync(file, 'utf8');
	const lines = text.split('\n');

	const fences = lines.filter((line) => line.startsWith('```')).length;
	if (fences % 2 !== 0) report(`${skill.path}: unbalanced code fences (${fences})`);

	const headings = lines
		.filter((line) => /^#{1,6}\s/.test(line))
		.map((line) => slugify(line.replace(/^#+\s*/, '')));
	const headingSet = new Set(headings);

	for (const required of skill.required) {
		if (!headingSet.has(required)) {
			report(`${skill.path}: missing required section "### ${required}"`);
		}
	}

	for (const match of text.matchAll(/\]\(#([a-z0-9-]+)\)/g)) {
		if (!headingSet.has(match[1])) report(`${skill.path}: anchor "#${match[1]}" has no heading`);
	}

	// Every helper the skill introduces is either implemented or listed.
	if (skill.helpers) for (const helper of HELPERS) {
		const defined = new RegExp(`(?:class|function|const|let)\\s+${helper}\\b`).test(text);
		const listed = new RegExp(`\\|\\s*\`${helper}\``).test(text);
		if (!defined && !listed) {
			report(`${skill.path}: helper "${helper}" is used but neither defined nor listed`);
		}
	}

	// A fixed delay may appear only where it is being called out as wrong, or where
	// it is a scheduling timer rather than a substitute for a projection wait.
	let section = '';
	let inAntiPattern = false;
	lines.forEach((line, index) => {
		if (/^#{2,4}\s/.test(line)) {
			section = slugify(line.replace(/^#+\s*/, ''));
			inAntiPattern = /anti-pattern/i.test(line);
		}
		if (!/setTimeout\(|sleep\(/.test(line)) return;
		if (inAntiPattern || TIMER_SECTIONS.has(section)) return;
		report(`${skill.path}:${index + 1}: fixed-delay guidance outside the anti-pattern section`);
	});
}

function collectTypeDeclarations(pkgRoot) {
	const files = [];
	const walk = (dir, depth) => {
		if (depth > 4) return;
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === 'node_modules' || entry.name === '.git') continue;
			const full = join(dir, entry.name);
			if (entry.isDirectory()) walk(full, depth + 1);
			else if (entry.name.endsWith('.d.ts') && statSync(full).size < 512_000) files.push(full);
		}
	};
	walk(pkgRoot, 0);
	return files.map((file) => readFileSync(file, 'utf8')).join('\n');
}

function walkToPackageRoot(start) {
	let dir = start;
	while (dir !== '/') {
		if (existsSync(join(dir, 'package.json'))) return dir;
		dir = dirname(dir);
	}
	return null;
}

function packageRoot(moduleId) {
	const require = createRequire(join(modulesDir, 'noop.js'));

	// Resolve the entry point and walk up: packages with an `exports` map often do
	// not expose `./package.json`, so resolving that path directly fails.
	try {
		return walkToPackageRoot(dirname(require.resolve(moduleId)));
	} catch {
		try {
			return dirname(require.resolve(`${moduleId}/package.json`));
		} catch {
			return null;
		}
	}
}

function checkApiDrift() {
	let checked = 0;
	let skipped = 0;

	for (const { pkg, symbols } of SYMBOLS) {
		const root = packageRoot(pkg);
		if (!root) {
			skipped += 1;
			const message = `${pkg}: not installed under ${modulesDir}; symbol check skipped`;
			if (strict) report(message);
			else warnings.push(message);
			continue;
		}

		const declarations = collectTypeDeclarations(root);
		for (const symbol of symbols) {
			checked += 1;
			const declared = new RegExp(
				`\\b(?:interface|type|class|function|const|let|enum)\\s+${symbol}\\b`
			).test(declarations);
			const reexported = new RegExp(
				`export\\s*(?:type\\s*)?\\{[^}]*\\b${symbol}\\b[^}]*\\}`
			).test(declarations);
			if (!declared && !reexported) report(`${pkg}: "${symbol}" no longer appears in the typings`);
		}
	}

	// The shutdown event name the SvelteKit appendix depends on.
	const adapterRoot = packageRoot('@sveltejs/adapter-node');
	if (adapterRoot) {
		const handler = join(adapterRoot, 'files/index.js');
		if (existsSync(handler) && !readFileSync(handler, 'utf8').includes('sveltekit:shutdown')) {
			report('@sveltejs/adapter-node: no longer emits "sveltekit:shutdown"');
		}
	} else {
		const message = '@sveltejs/adapter-node: not installed; shutdown-event check skipped';
		if (strict) report(message);
		else warnings.push(message);
	}

	return { checked, skipped };
}

for (const skill of SKILLS) checkStructure(skill);
const drift = checkApiDrift();

if (flag('check-installed')) {
	const installed = join(homedir(), '.agents/skills/evtstore-reference/SKILL.md');
	const source = join(repoRoot, 'skills/evtstore-reference/SKILL.md');
	if (existsSync(installed) && readFileSync(installed, 'utf8') !== readFileSync(source, 'utf8')) {
		report('installed evtstore-reference differs from the repository copy');
	}
}

for (const warning of warnings) console.warn(`warn: ${warning}`);
for (const problem of problems) console.error(`fail: ${problem}`);

if (problems.length > 0) {
	console.error(
		`\n${problems.length} problem(s); ${drift.checked} symbol(s) checked, ${drift.skipped} package(s) skipped.`
	);
	process.exitCode = 1;
} else {
	console.log(
		`skills ok — ${drift.checked} symbol(s) checked, ${drift.skipped} package(s) skipped${warnings.length ? `, ${warnings.length} warning(s)` : ''}`
	);
}
