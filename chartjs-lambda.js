'user strict';

const debug = require('debug');
const { CanvasRenderService } = require('chartjs-node-canvas');
const aws = require('aws-sdk');
const s3 = new aws.S3();

const signedUrlExpireSeconds = 60 * 5;

PDFDocument = require ('pdfkit');

// bug workaround: https://github.com/vmpowerio/chartjs-node/issues/26
if (global.CanvasGradient === undefined) {
    global.CanvasGradient = function() {};
}

async function storeFile(buffer, filename) {
    console.log("Storing file to: " + process.env.BUCKET_NAME);
    const object = {
        Bucket: process.env.BUCKET_NAME,
        Key: filename,
        Body: buffer
    };

    try {
        await s3.putObject(object).promise();
        return filename;
    } catch(err) {
        console.error("Failed to store image: " + err);
        throw err;
    }
}

async function renderChartWithChartJS() {
    const width = 600;
    const height = 600;
    const configuration = {
        type: 'bar',
        data: {
            labels: ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'Orange'],
            datasets: [{
                label: '# of Votes',
                data: [12, 19, 3, 5, 2, 3],
                backgroundColor: [
                    'rgba(255, 99, 132, 0.2)',
                    'rgba(54, 162, 235, 0.2)',
                    'rgba(255, 206, 86, 0.2)',
                    'rgba(75, 192, 192, 0.2)',
                    'rgba(153, 102, 255, 0.2)',
                    'rgba(255, 159, 64, 0.2)'
                ],
                borderColor: [
                    'rgba(255,99,132,1)',
                    'rgba(54, 162, 235, 1)',
                    'rgba(255, 206, 86, 1)',
                    'rgba(75, 192, 192, 1)',
                    'rgba(153, 102, 255, 1)',
                    'rgba(255, 159, 64, 1)'
                ],
                borderWidth: 1
            }]
        },
        options: {
            scales: {
                yAxes: [{
                    ticks: {
                        beginAtZero: true,
                        callback: (value) => '$' + value
                    }
                }]
            }
        }
    };
    const chartCallback = (ChartJS) => {
        ChartJS.defaults.global.responsive = true;
        ChartJS.defaults.global.maintainAspectRatio = false;
    };

    debug("Rendering chart");
    const canvasRenderService = new CanvasRenderService(width, height, chartCallback);
    return await canvasRenderService.renderToBuffer(configuration);
}

let notifyEnd;

async function waitProcessToEnd() {
    return new Promise(function(resolve) {
        notifyEnd = resolve;
    })
}

module.exports.renderChart = async function(event, context, callback) {
    const buffer = await renderChartWithChartJS();
    storeFile(buffer, 'out.png');

    let doc = new PDFDocument;
    let buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    doc.on('end', () => {

        console.log('Storing pdf')

        let pdfData = Buffer.concat(buffers);
        let pdfFileName = 'out.pdf';
        storeFile(pdfData, pdfFileName);

        const url = s3.getSignedUrl('getObject', {
            Bucket: process.env.BUCKET_NAME,
            Key: pdfFileName,
            Expires: signedUrlExpireSeconds
        });

        console.log('Stored pdf. Url: ' + url);
        notifyEnd(url);
    });

    doc.image(buffer, 50, 200, {width: 400});
    doc.end();

    let url = await waitProcessToEnd();
    console.log('Finished pdf document');

    const response = {
        statusCode: 200,
        body: url
    };

    callback(null, response);
}
