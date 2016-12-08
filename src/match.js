'use strict';

var xhr = require('xhr'),
    tidy = require('geojson-tidy'),
    polyline = require('polyline'),
    queue = require('queue-async');

var VALID_PROFILES = [
    'driving',
    'walking',
    'cycling'
];

function match(geojson, options, callback) {
    options = options || {};

    // Configure mapmatching API endpoint
    var mapMatchAPI;
    if (options.mapMatchAPI) {
        mapMatchAPI = options.mapMatchAPI;
    } else if (VALID_PROFILES.indexOf(options.profile) >= 0) {
        mapMatchAPI = "https://api.tiles.mapbox.com/matching/v4/mapbox." + options.profile + ".json";
    } else {
        callback(new Error("Need either mapmatchAPI endpoint or profile of " + VALID_PROFILES.join(", ")));
    }
    var xhrUrl = mapMatchAPI + "?access_token=" + L.mapbox.accessToken + "&geometry=polyline";

    if (options.gpsPrecision) {
        xhrUrl += "&gps_precision=" + options.gpsPrecision;
    }

    // empty queue for storing responses
    var q = queue();

    function matchFeature(feature, cb) {
        var xhrOptions = {
            body: JSON.stringify(feature),
            uri: xhrUrl,
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            }
        };

        xhr(xhrOptions, function (err, response, body) {

            // Polyline decoder
            var matchedFeature = JSON.parse(body);
            matchedFeature.features = matchedFeature.features.map(function (feature) {
                var decodedFeature = {
                    "type": "Feature",
                    "properties": feature.properties,
                    "geometry": {
                        "type": "LineString",
                        // Invert latLon to lonLat because polyline is left brained
                        "coordinates": polyline.decode(feature.geometry, 6).map(function (coords) {
                            return [coords[1], coords[0]];
                        })
                    }
                };
                return decodedFeature;
            });

            // Return matched geojson
            cb(err, matchedFeature);
        });
    }

    // First tidy the input geojson to remove noisy points and match every feature using the API

    var inputGeometries = tidy.tidy(geojson, {
        "minimumDistance": options.minimumDistance || 10,
        "minimumTime": 5,
        "maximumPoints": 100
    });

    for (var i = 0; i < inputGeometries.features.length; i++) {
        q.defer(matchFeature, inputGeometries.features[i]);
    }


    // After all the features are matched merge them into a single feature collection

    q.awaitAll(function (error, results) {
        var mergedResults = results[0];
        for (var i = 1; i < results.length; i++) {
            mergedResults.features.push(results[i].features[0]);
        }

        // Return the features or leaflet layer        
        if (options.output == "geojson") {
            callback(error, mergedResults);
        } else {
            var featureLayer = L.mapbox.featureLayer(mergedResults);
            callback(error, featureLayer);
        }

    });

}

module.exports = function (feature, options, callback) {
    if (!callback) {
        callback = options;
        options = {};
    }
    return new match(feature, options, callback);
};
