module.exports = {
  apps: [{
    name:          'polymart-bot',
    script:        'src/index.js',
    interpreter:   `${process.env.HOME}/.bun/bin/bun`,
    watch:         false,
    autorestart:   true,
    max_restarts:  15,
    restart_delay: 5000,
    exp_backoff_restart_delay: 100,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file:  'logs/error.log',
    out_file:    'logs/out.log',
    merge_logs:  true,
  }],
};
