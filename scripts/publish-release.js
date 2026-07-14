const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const packageJson = require(path.join(root, 'package.json'));
const version = packageJson.version;
const tag = `v${version}`;
const repo = 'madiaznx/madiaznx-updates';
const assets = [
  path.join(root, 'dist', 'MadiaznX-Hub-Setup.exe'),
  path.join(root, 'dist', 'MadiaznX-Hub-Setup.exe.blockmap'),
  path.join(root, 'dist', 'latest.yml'),
  path.join(root, 'dist', `MadiaznX-Hub-Setup-v${version}.exe`)
];

for (const asset of assets) {
  if (!fs.existsSync(asset)) {
    throw new Error(`Asset nao encontrado: ${asset}`);
  }
}

const releaseExists = (() => {
  try {
    execFileSync('gh', ['release', 'view', tag, '--repo', repo], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

if (!releaseExists) {
  execFileSync('gh', [
    'release',
    'create',
    tag,
    '--repo',
    repo,
    '--target',
    'main',
    '--title',
    `MadiaznX Hub ${tag}`,
    '--notes',
    `MadiaznX Hub ${tag}`
  ], { stdio: 'inherit' });
}

execFileSync('gh', [
  'release',
  'upload',
  tag,
  ...assets,
  '--repo',
  repo,
  '--clobber'
], { stdio: 'inherit' });
