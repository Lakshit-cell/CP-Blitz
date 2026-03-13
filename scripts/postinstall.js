const { execSync } = require('child_process');

const hasClientDeps = () => {
  try {
    execSync('npm --prefix client ls --depth=0 --production=false', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
};

if (!hasClientDeps()) {
  execSync('npm install --prefix client --production=false', { stdio: 'inherit' });
}
