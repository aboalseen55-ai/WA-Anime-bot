// utils/metrics.js
class Metrics {
  constructor() {
    this.metrics = {
      commandsExecuted: 0,
      messagesProcessed: 0,
      errorsCount: 0,
      gamesStarted: 0,
      usersRegistered: 0,
      responseTime: [],
      startTime: Date.now()
    };
  }

  increment(metric) {
    if (this.metrics[metric] !== undefined) {
      this.metrics[metric]++;
    }
  }

  recordResponseTime(time) {
    this.metrics.responseTime.push(time);
    // الاحتفاظ بآخر 100 قياس
    if (this.metrics.responseTime.length > 100) {
      this.metrics.responseTime.shift();
    }
  }

  getStats() {
    const uptime = Math.round((Date.now() - this.metrics.startTime) / 1000);
    const avgResponseTime = this.metrics.responseTime.length > 0
      ? Math.round(this.metrics.responseTime.reduce((a, b) => a + b, 0) / this.metrics.responseTime.length)
      : 0;

    return {
      ...this.metrics,
      uptime,
      avgResponseTime,
      responseTimeSamples: this.metrics.responseTime.length
    };
  }

  reset() {
    this.metrics.commandsExecuted = 0;
    this.metrics.messagesProcessed = 0;
    this.metrics.errorsCount = 0;
    this.metrics.gamesStarted = 0;
    this.metrics.usersRegistered = 0;
    this.metrics.responseTime = [];
  }
}

export const metrics = new Metrics();

// دوال مساعدة
export const trackCommand = () => metrics.increment('commandsExecuted');
export const trackMessage = () => metrics.increment('messagesProcessed');
export const trackError = () => metrics.increment('errorsCount');
export const trackGameStart = () => metrics.increment('gamesStarted');
export const trackUserRegistration = () => metrics.increment('usersRegistered');
export const trackResponseTime = (time) => metrics.recordResponseTime(time);
