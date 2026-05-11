// utils/logger.js
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

// تنسيقات الـ log
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;

    // إضافة metadata إذا وجد
    if (Object.keys(meta).length > 0) {
      log += ` | ${JSON.stringify(meta)}`;
    }

    return log;
  })
);

// transport للملفات اليومية
const dailyRotateTransport = new DailyRotateFile({
  filename: 'logs/bot-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
  format: logFormat
});

// transport للـ console
const consoleTransport = new winston.transports.Console({
  format: winston.format.combine(
    winston.format.colorize(),
    logFormat
  )
});

// إنشاء logger
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  transports: [
    consoleTransport,
    dailyRotateTransport
  ],
  exceptionHandlers: [
    new winston.transports.File({ filename: 'logs/exceptions.log' })
  ],
  rejectionHandlers: [
    new winston.transports.File({ filename: 'logs/rejections.log' })
  ]
});

// دوال مساعدة للـ logging السريع
export const logCommand = (user, command, group = null) => {
  logger.info('Command executed', {
    user: user.jid,
    command,
    group,
    timestamp: new Date().toISOString()
  });
};

export const logError = (error, context = {}) => {
  logger.error('Error occurred', {
    error: error.message,
    stack: error.stack,
    ...context
  });
};

export const logUserAction = (action, user, details = {}) => {
  logger.info(`User ${action}`, {
    user: user.jid,
    ...details
  });
};

export const logGameEvent = (gameType, event, details = {}) => {
  logger.info(`Game event: ${gameType}`, {
    event,
    ...details
  });
};
