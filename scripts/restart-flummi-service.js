const { spawnSync } = require('child_process');

setTimeout(() => {
    spawnSync('systemctl', ['--user', 'restart', 'flummi.service'], { stdio: 'ignore' });
}, 750);
