const { execSync } = require('child_process');

const hasClientDeps = () => {
  try {
    execSync('npm --prefix client ls --depth=0 --production=false', { stdio: 'ignore' });
    return true;
  } catch (error) {
    console.warn('Client dependencies missing or invalid; reinstalling.');
    if (error?.message) {
      console.warn(error.message.split('\n')[0]);
    }
    return false;
  }
};

if (!hasClientDeps()) {
  try {
    execSync('npm install --prefix client --production=false', { stdio: 'inherit' });
  } catch (error) {
    console.error('Failed to install client dependencies.');
    if (error?.message) {
      console.error(error.message.split('\n')[0]);
    }
    process.exit(error?.code ?? 1);
  }
}
