"use strict";

var stream = require("stream");
var process = require("process");
var path = require("path");
var inputStream = new stream.Readable();
var transformStream = new stream.Transform({
    writableObjectMode: true,
    readableObjectMode: false,
    transform: function(chunk, encoding, callback) {
        callback(null, JSON.stringify(chunk) + "\n");
    }
});

var AggregatorStream = require(path.join(__dirname, "aggregator"));
var aggregatorStream = new AggregatorStream();
// error event is emitted if an error occured on parsing
aggregatorStream.on("error", function(err) {
    process.stderr.write(err.toString());
});
// end event is emitted when all feeds are parsed
aggregatorStream.on("end", function() {
    process.stdout.write("end");
});
inputStream
    .pipe(aggregatorStream)
    .pipe(transformStream)
    .pipe(process.stdout);
inputStream.push("http://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml");
inputStream.push("https://news.ycombinator.com/rss");
// emit input end
inputStream.push(null);
