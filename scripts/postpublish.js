const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const mkdirSync = require('mkdirp').sync;
const pkg = require('../package.json');

const destFolder = path.join('published');
const target = path.join(destFolder, `${pkg.name}@${pkg.version}.tgz`);
const url = `http://registry.ecd.axway.int:8081/artifactory/local-npm/${pkg.name}/-/${pkg.name}-${pkg.version}.tgz`;

console.log(`Downloading ${url} to ./${target}`);

// May be a scoped package folder
const targetDir = path.dirname(target);
if (!fs.existsSync(targetDir)) {
	mkdirSync(targetDir);
}

const result = spawnSync('curl', [ '-o', target, '-X', 'GET', url ]);

if (result.error) {
	throw result.error;
}
