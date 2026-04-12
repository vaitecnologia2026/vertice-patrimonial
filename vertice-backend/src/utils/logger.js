const winston = require('winston');

// Na Vercel (production) o filesystem é read-only exceto /tmp
const logDir = process.env.NODE_ENV === 'production' ? '/tmp/logs' : 'logs';

const transports = [
  new winston.transports.File({ filename: `${logDir}/error.log`, level: 'error' }),
  new winston.transports.File({ filename: `${logDir}/combined.log` }),
];

// Em produção também loga no console (capturado pelo runtime da Vercel)
if (process.env.NODE_ENV === 'production') {
  transports.push(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.json()
    ),
  }));
} else {
  transports.push(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    ),
  }));
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports,
});

module.exports = logger;
