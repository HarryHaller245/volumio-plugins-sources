class CustomLogger {
    constructor(logger, moduleName, className) {
        this.logger = logger;
        this.transports = logger.transports;
        this.moduleName = moduleName;
        this.className = className;
    }

    formatMessage(message) {
        return `[${this.moduleName}] [${this.className}] ${message}`;
    }

    info(message) {
        this.logger.info(this.formatMessage(message));
    }

    debug(message) {
        this.logger.debug(this.formatMessage(message));
    }

    warn(message) {
        this.logger.warn(this.formatMessage(message));
    }

    error(message) {
        this.logger.error(this.formatMessage(message));
    }
}

module.exports = CustomLogger;