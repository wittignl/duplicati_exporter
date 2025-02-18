const express = require('express');
const promClient = require('prom-client');
const bodyParser = require('body-parser');
const argv = require('yargs')
    .usage('Usage: $0 [options]')
    .example('$0 -p 9010', 'Use port 9010')
    .alias('p', 'port')
    .alias('h', 'help')
    .default('p', 9118)
    .describe('p', 'Server port')
    .help('h')
    .argv;

// Initialize Express app
const app = express();
app.use(bodyParser.json());

// Initialize Prometheus metrics
const register = new promClient.Registry();

// Define metrics
const backupStatus = new promClient.Gauge({
    name: 'duplicati_backup_status',
    help: 'Status of the last Duplicati backup (1 = success, 0 = failure)',
    labelNames: ['backup_name', 'machine_name']
});

const backupStatusString = new promClient.Gauge({
    name: 'duplicati_backup_status_state',
    help: 'Status of the last Duplicati backup as a string (1 = success, 2 = warning, 3 = error)',
    labelNames: ['backup_name', 'machine_name', 'status']
});

const backupDuration = new promClient.Gauge({
    name: 'duplicati_backup_duration_seconds',
    help: 'Duration of the last Duplicati backup in seconds',
    labelNames: ['backup_name', 'machine_name']
});

const backupFilesIncluded = new promClient.Gauge({
    name: 'duplicati_backup_files_included',
    help: 'Number of files included in the last Duplicati backup',
    labelNames: ['backup_name', 'machine_name']
});

const backupSize = new promClient.Gauge({
    name: 'duplicati_backup_size_bytes',
    help: 'Size of the last Duplicati backup in bytes',
    labelNames: ['backup_name', 'machine_name']
});

// Register metrics
register.registerMetric(backupStatus);
register.registerMetric(backupStatusString);
register.registerMetric(backupDuration);
register.registerMetric(backupFilesIncluded);
register.registerMetric(backupSize);

// Helper function to convert status to numeric value
function getStatusValue(status) {
    switch (status) {
        case 'Success': return 1;
        case 'Warning': return 2;
        case 'Error': return 3;
        default: return 3; // Default to error for unknown states
    }
}

// Webhook endpoint to receive Duplicati reports
app.post('/webhook', (req, res) => {
    try {
        const report = req.body;
        const backupName = report.Extra['backup-name'];
        const machineName = report.Extra['machine-name'];
        const status = report.Data.ParsedResult;
        
        // Parse duration string to seconds (format: "HH:mm:ss.fffffff")
        const durationParts = report.Data.Duration.split(':');
        const hours = parseInt(durationParts[0]);
        const minutes = parseInt(durationParts[1]);
        const seconds = parseFloat(durationParts[2]);
        const durationInSeconds = (hours * 3600) + (minutes * 60) + seconds;

        // Update metrics
        backupStatus.set(
            { backup_name: backupName, machine_name: machineName },
            status === 'Success' ? 1 : 0
        );

        // Update status string metric
        backupStatusString.set(
            { backup_name: backupName, machine_name: machineName, status },
            getStatusValue(status)
        );

        backupDuration.set(
            { backup_name: backupName, machine_name: machineName },
            durationInSeconds
        );

        backupFilesIncluded.set(
            { backup_name: backupName, machine_name: machineName },
            report.Data.ExaminedFiles
        );

        backupSize.set(
            { backup_name: backupName, machine_name: machineName },
            report.Data.SizeOfAddedFiles
        );

        res.status(200).json({ status: 'success' });
    } catch (error) {
        console.error('Error processing webhook:', error);
        res.status(500).json({ status: 'error', message: error.message || 'Unknown error' });
    }
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
    try {
        const metrics = await register.metrics();
        res.set('Content-Type', register.contentType);
        res.end(metrics);
    } catch (error) {
        console.error('Error collecting metrics:', error);
        res.status(500).json({ status: 'error', message: error.message || 'Unknown error' });
    }
});

// Start server
const PORT = process.env.PORT || argv.port;
app.listen(PORT, () => {
    console.log(`Duplicati exporter listening on port ${PORT}`);
});
