"use strict";
var stream = require("stream");
var util = require("util");
var Duplex = stream.Duplex;
var Promise = require("bluebird");
var Error = require("@petitchevalroux/error");

function CombinatorStream(options) {
    if (!(this instanceof CombinatorStream)) {
        return new CombinatorStream(options);
    }
    options = options || {};
    this.concurrency = options.concurrency ? options.concurrency : 2;
    this.FeedParser = require("feedparser");
    this.request = require("request");
    this.async = require("async");
    delete options.concurrency;
    options.readableObjectMode = true;
    Duplex.call(this, options);
    var self = this;
    self.queue = self.async.queue(
        function(feed, callback) {
            self.parse(feed)
                .then(function() {
                    callback();
                    return;
                })
                .catch(function(err) {
                    self.emit("error", new Error(
                        "Error parsing feed: %s",
                        feed, err));
                    callback(err);
                });
        },
        self.concurrency
    );
    this.items = [];
}

/**
 * Call when feeds are push in input 
 * @param {mixed} chunk
 * @param {type} enc
 * @param {type} cb
 * @returns {undefined}
 */
CombinatorStream.prototype._write = function(chunk, enc, cb) {
    this.queue.push(typeof chunk === "string" ? chunk : chunk.toString());
    cb();
};

/**
 * Read items extracted from feeds
 * @returns {undefined}
 */
CombinatorStream.prototype._read = function() {
    // We have nothing to read
    if (!this.items.length) {
        // Nothing is processing, we end
        if (this.queue.idle()) {
            this.push(null);
        } else {
            // Something is processing, we push a new read at the end of the
            // event loop 
            var self = this;
            setImmediate(function() {
                self._read();
            });
        }
    } else {
        var stop = false;
        while (this.items.length > 0 && !stop) {
            var chunk = this.items.shift();
            stop = !this.push(chunk);
        }
    }
};

/**
 * Parse a feed
 * @param {string} url
 * @returns {Promise}
 */
CombinatorStream.prototype.parse = function(url) {
    var self = this;
    return new Promise(function(resolve, reject) {
        try {
            var parser = new self.FeedParser();
            var req = self.request(url);
            req.on("error", function(err) {
                new Error(
                    "Error requesting feed: %s",
                    url,
                    err
                );
            });
            req.on("response", function(response) {
                var stream = this;
                if (response.statusCode !== 200) {
                    this.emit("error", new Error(
                        "Bad status code: %s",
                        response.statusCode
                    ));
                } else {
                    stream.pipe(parser);
                }
            });
            parser.on("error", function(err) {
                new Error(
                    "Error parsing feed: %s",
                    url,
                    err
                );
            });
            parser.on("readable", function() {
                var item;
                while ((item = this.read())) {
                    self.items.push(item);
                }
            });
            parser.on("end", function() {
                resolve(true);
            });
        } catch (err) {
            reject(err);
        }
    });
};

util.inherits(CombinatorStream, Duplex);
module.exports = CombinatorStream;
