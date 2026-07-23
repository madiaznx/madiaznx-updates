const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const packageJson = require(path.join(root, 'package.json'));
const stableSetupName = 'MadiaznX-Hub-Setup.exe';
const versionedSetupName = `MadiaznX-Hub-Setup-v${packageJson.version}.exe`;
const stableSetupPath = path.join(root, 'dist', stableSetupName);
const versionedSetupPath = path.join(root, 'dist', versionedSetupName);

for (const part of String(packageJson.version).split('.')) {
  if (Number(part) > 9) {
    throw new Error(`Versao invalida: ${packageJson.version}. Use no maximo .9 em cada parte; depois avance a parte anterior.`);
  }
}

if (!fs.existsSync(stableSetupPath)) {
  throw new Error(`Setup nao encontrado: ${stableSetupPath}`);
}

fs.copyFileSync(stableSetupPath, versionedSetupPath);
console.log(`Release asset criado: dist/${versionedSetupName}`);
