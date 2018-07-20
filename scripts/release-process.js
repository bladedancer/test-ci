const fs = require('fs');
const npm = require('npm');
const path = require('path');
const { promisify } = require('util');
const releaseNames = require('./release-names.json');
const simpleGit = require('simple-git')(path.join(__dirname, '..'));
const program = require('commander');

program.version('1.0.0')
    .option('-d, --dry-run', 'Do not perform the release.')
    .option('-s, --ship', 'Ship the release')
    .parse(process.argv);

// The package containing the version name.
const versionedPackage = '@bladedancer/mod-abc';

const readdirAsync = promisify(fs.readdir);
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);

const gitAddAsync = promisify(simpleGit.add).bind(simpleGit);
const gitCommitAsync = promisify(simpleGit.commit).bind(simpleGit);
const gitPushAsync = promisify(simpleGit.push).bind(simpleGit);

/**
 * Return the package version information.
 * @returns {array} - The current version details.
 */
async function getCurrentVersions() {
	const root = path.join(__dirname, '..', 'packages');
	const dirs = await readdirAsync(root);
	const verDetail = dirs.map(async dir => {
		const pkgJson = await readFileAsync(path.join(root, dir, 'package.json'), { encoding: 'utf-8' })
			.then(data => JSON.parse(data));
		return {
			path: path.join(root, dir),
			name: pkgJson.name,
			version: pkgJson.version,
			json: pkgJson
		};
	});
	return await Promise.all(verDetail);
}

/**
 * Get the registry versions.
 * @param {array} pkgs - The list of packages to query the registry for.
 * @returns {array} - The registry dist-tag details.
 */
async function getRegistryVersions(pkgs) {
	await promisify(npm.load)({});
	const npmDistTagAsync = promisify(npm.commands['dist-tags']);

	const tagDetail = pkgs.map(async pkg => {
		console.log(`npm dist-tag ls ${pkg}`);
		const distTags = await npmDistTagAsync([ 'ls', pkg ]);
		return {
			name: pkg,
			tags: distTags ? { ...distTags } : {}
		};
	});

	return await Promise.all(tagDetail);
}

/**
 * Combine the registry information and local information into a single
 * hash.
 * @param {array} currentVersions - The local package details.
 * @param {array} registryVersions - The registry details.
 * @returns {object} - The merged details.
 */
function mergeVersionDetail(currentVersions, registryVersions) {
	let pkgs = currentVersions.reduce((col, cur) => {
		col[cur.name] = { ...cur };
		return col;
	}, {});
	pkgs = registryVersions.reduce((col, cur) => {
		col[cur.name] = {
			...col[cur.name],
			...cur
		};
		return col;
	}, pkgs);

	return pkgs;
}

/**
 * Check that the @next version is the current latest in the repo, if not somethings wrong and shipping is not safe.
 * @param {array} versionDetail - The local package details.
 */
function checkVersions(versionDetail) {
	Object.values(versionDetail).forEach(pkg => {
		if (pkg.version !== pkg.tags.next) {
			const msg = `Cannot release as next does not match git version. The next version of ${pkg.name} (${pkg.tags.next}) is not the same as the local repo version (${pkg.version}).`;
			throw new Error(msg);
		}
	});

	const dirtyPkgs = Object.values(versionDetail).filter(pkg => pkg.tags.latest !== pkg.tags.next);
	if (dirtyPkgs.length === 0) {
		throw new Error('No packages have been modified, there is nothing to release.');
	} else {
		dirtyPkgs.forEach(pkg => {
			console.log(`Release delta: ${pkg.name}@${pkg.tags.latest} => ${pkg.name}@${pkg.version}`);
		});
	}
}

/**
 * Get the next name for the release.
 * @param {array} versionDetail - The local package details.
 * @returns {string} - The name for the next release.
 */
function nextReleaseName(versionDetail) {
	const releaseName = versionDetail[versionedPackage].json['api-builder'].release;
	const curIndex = releaseNames.findIndex(name => name === releaseName);

	if (curIndex === -1) {
		throw new Error(`The existing release name (${releaseName}) is not found in release names list.`);
	}
	if (curIndex === releaseNames.length) {
		throw new Error(`The existing release name (${releaseName}) is the last in the list of named releases.`);
	}

	const nextName = releaseNames[curIndex + 1];

	const duplicates = Object.values(versionDetail).filter(pkg => Object.keys(pkg.tags).indexOf(nextName) !== -1);
	if (duplicates.length > 0) {
		const msg = duplicates.map(dup => `${dup.name}@${dup.tags[nextName]}`).join(', ');
		throw new Error(`The release name (${releaseName}) has already been used by ${msg}.`);
	}

	return nextName;
}

/**
 * Tag the release in NPM.
 * @param {array} versionDetail - The local package details.
 * @param {array} tags - The tags to apply.
 * @returns {array} - The tags.
 */
async function tagRelease(versionDetail, tags) {
	await promisify(npm.load)({});
	const npmDistTagAsync = promisify(npm.commands['dist-tags']);

	const tagDetail = [];
	Object.values(versionDetail).forEach(pkg => {
		tags.forEach(tag => {
			const nameVer = `${pkg.name}@${pkg.version}`;
			const safeTag = tag.toLowerCase().replace(/\s/g, '_');
			console.log(`npm dist-tag add ${nameVer} ${safeTag}`);
			tagDetail.push(npmDistTagAsync([ 'add', nameVer, safeTag ]));
		});
	});

	return await Promise.all(tagDetail);
}

/**
 * Use the next release.
 * @param {array} versionDetail - The local package details.
 * @param {string} newName - The name for the next release.
 */
async function updateReleaseName(versionDetail, newName) {
	const relRoot = path.relative(
		path.join(__dirname, '..'),
		versionDetail[versionedPackage].path
	);
	const pkgJsonPath = path.join(relRoot, 'package.json');
	const newPkgJson = JSON.parse(JSON.stringify(versionDetail[versionedPackage].json));
	newPkgJson['api-builder'].release = newName;

	const commitMessage = [
		`Released ${versionDetail[versionedPackage].json['api-builder'].release} [ci-skip]`,
		Object.values(versionDetail).map((pkg) => pkg.name + '@' + pkg.version).join('\n'),
		`Next Release: ${newName}`
	];

	console.log(`Updating ${pkgJsonPath}\n${commitMessage.join('\n')}`);
	await writeFileAsync(pkgJsonPath, JSON.stringify(newPkgJson, null, '\t'));
	
	console.log(`git add ${pkgJsonPath}`);
	await gitAddAsync([ pkgJsonPath ]);
	
	console.log('git commit');
	await gitCommitAsync(commitMessage);

	console.log('git push');
	await gitPushAsync();
}

/**
 * The ship process:
 * Get the current version of all the modules in pkg
 * Get the @next version of all the modules in the registry
 * Error: If current version is later than @next then it was never released.
 * Select next market tag.
 * Error: If next cannot be figured out.
 * Tag all the versions with @latest.
 * Tag all the versions with release dist-tag (made safe)
 * Update package.json without triggering CI (<<< This requires repo update so has to be head).
 */
async function ship() {
	try {
		const currentVersions = await getCurrentVersions();
		const registryVersions = await getRegistryVersions(currentVersions.map(v => v.name));
		const versionDetail = mergeVersionDetail(currentVersions, registryVersions);

		checkVersions(versionDetail);
		const nextName = nextReleaseName(versionDetail);

        if (!program.dryRun) {
            await tagRelease(versionDetail, [ 'latest', nextName ]);
            await updateReleaseName(versionDetail, nextName);
        }
	} catch (err) {
		console.error(`Ship failed. ${err.message || err}`, err);
		process.exit(1);
	}
}

// Main
if (program.ship) {
    ship();
} else {
    console.log('Nothing to do.');
}
