const { execSync } = require('child_process');

const getErrorOutput = (error) => {
  if (error?.stderr) {
    return String(error.stderr).trim();
  }
  if (error?.stdout) {
    return String(error.stdout).trim();
  }
  return error?.message ? String(error.message).trim() : '';
};

const hasClientDeps = () => {
  try {
    execSync('npm --prefix client ls --depth=0', { stdio: 'ignore' });
    return true;
  } catch (error) {
    console.warn('Client dependencies missing or invalid; reinstalling.');
    const details = getErrorOutput(error);
    if (details) {
      console.warn(details);
    }
    return false;
  }
};

if (!hasClientDeps()) {
  try {
    execSync('npm install --prefix client --production=false', { stdio: 'inherit' });
  } catch (error) {
    console.error('Failed to install client dependencies.');
    const details = getErrorOutput(error);
    if (details) {
      console.error(details);
    }
    const exitCode = typeof error?.status === 'number' ? error.status : 1;
    process.exit(exitCode);
  }
}
