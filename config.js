//forever -v -a -w -l /var/www/tgm/logs/forever.log -o ./logs/console.log -e ./logs/error.log start ./server.js
//forever -v -a -w -l /projects/tg/tgm/logs/forever.log -o ./logs/console.log -e ./logs/error.log start ./server.js
//forever -v -a -w -l /var/www/mdaemon/daemons/comet/logs/forever.log -o ./logs/console.log -e ./logs/error.log start ./server.js

var colors = require('colors');
//var fs = require('fs');

/**
 * Log storage settings
 */
var logs;
var mongo = require('mongodb');
var mongodb = new mongo.Db('log', new mongo.Server('', 27017, {}), {forceServerObjectId: false});
mongodb.open(function (err) {
    mongodb.createCollection('trace', function onCreate(err, collection) {
        logs = collection;
        //mongodb.collection('trace', function onGetCollection(err, collection) {
    });
});

global.ERROR = {
    ARGUMENTS: 'invalid arguments',
    OPERATION: 'operation is not performed',
    SERVICE: 'service not available'
    // ... any other error type-codes
};

var config = exports.config = {
    /**
     * Debug & trace settings
     */
    debug: {enabled: true, level: []},
    /**
     * Log settings
     */
    log: {
        beat: 0.1 * 60 * 60, // heartbeat interval setting (ms) for time-periodic log messages
        transport: {
            level: '',
            methods: [ 'mem', 'transport', 'integrity', 'connect', 'disconnect', 'promise',
                       'log', 'trace', 'debug', 'info', 'warn', 'notice', 'error' ],
            format: [ '{{timestamp}} {{message}}', {error: '{{timestamp}} <{{title}}> {{message}} (in {{file}}:{{line}})'} ],
            dateformat: 'HH:MM:ss', //.L
            transport: function log(data) {
                if (!logs){
                    return console.log(data.message);
                }

                logs.insert(data, function onCollectionInsert(err, result) {
                    if (err) { console.error(err); }
                });

                //                fs.open('./logs/server.log', 'a', 0666, function (e, id) {
                //                    fs.write(id, data.output + "\n", null, 'utf8', function () {
                //                        fs.close(id, function () { });
                //                    });
                //                });
            },
            filters: {
                mem: [ colors.black, colors.bold, colors.underline ],
                transport: [ colors.grey ], //cyan
                integrity: [ colors.black, colors.bold ], //colors.rainbow
                connect: [ colors.green, colors.underline ],
                disconnect: [ colors.red, colors.underline ],
                promise: [colors.magenta, colors.bold],
                log: colors.black,
                trace: colors.magenta,
                debug: colors.cyan, //blue
                info: colors.green,
                warn: colors.yellow,
                notice: [ colors.red ],
                error: [ colors.red, colors.bold ]
            }
        }
    },
    /**
     * HTTP-server settings (site requests)
     */
    server: {
        host: '',
        port: 0,
        /**
         * Socket-server settings (system requests)
         */
        socket: {
            host: '',
            port: 0
        }
    },
    /**
     * SockJS settings
     */
    sockjs: {
        prefix: '/ws',
        websocket: true,
        //heartbeat_delay: 25 * 1000,
        //disconnect_delay: 50 * 1000,
        //response_limit: 128 * 1024,
        log: function log(severity, message) {

        }
    },
    /**
     * Redis connection settings
     */
    redis: { // pubsub
        host: '',
        port: 0
    },
    /**
     * MongoDb connection settings
     */
    mongo: {
        host: '',
        port: 0,
        db: '',
        user: '',
        password: ''
        /*{native_parser:true}*/
    },
    /**
     * List of enabled services (name must match the file structure in ./lib/services).
     * Each service can have its settings in a nested object.
     */
    services: {
        users: {},
        streams: {},
        statuses: {},
        notifies: {},
        dialogs: {
            chunk: 3, /// how many history messages loads on demand
            tail: 5 /// how many messages loads on dialog open
        },
        chat: {
            capacity: 50, /// history capacity, FIFO
            tail: 20 /// how many messages loads on chat open
        },
        observers: {}
    },
    /**
     * Token to authorize system requests
     */
    token: '',
    compatible: { /// compatibility service-name map (system calls)
        auth: 'users',
        onlinestatus: 'statuses',
        stream: 'streams',
        message: 'dialogs',
        notify: 'notifies'
    },
    /**
     * The list of prohibited events for service
     */
    denied: {
        notifies: ['newNotify']
    },
    /**
     * Permits and codes for custom action.
     * Encoded as a bitmap. Offset: the action, value: the permit type.
     * Example: 00000130002, add comments denied for all, sending messages is permitted only for subseribers,
     * viewing email is permitted only for friends, other actions is permitted for all
     */
    user: {
        privacy: {
            codes: {
                ANY: 0,
                NONE: 1,
                FRIEND: 2,
                SUBSCRIBER: 3,
                FRIEND_AND_SUBSCRIBER: 4
            },
            VIEW_AGE: 0,
            VIEW_REAL_NAME: 1,
            VIEW_DEVICES: 2,
            INVITE: 3,
            ADD_POST: 4,
            ADD_COMMENT: 5,
            SEND_MESSAGE: 6,
            VIEW_ADDRESS: 7,
            VIEW_PHONE: 8,
            VIEW_SITE: 9,
            VIEW_EMAIL: 10,
            VIEW_ICQ: 11,
            VIEW_SKYPE: 12
        },
        notifications: {
            codes: {
                SITE: 1,
                EMAIL: 2
            },
            FRIEND_INVITE: 0,
            FRIEND_ADD: 1,
            SUBSCRIBER: 2,
            POST: 3,
            LIKE: 4,
            COMMENT: 5
        }
    }
};

var argv = require('optimist').argv;
if (argv.host) { exports.config.host = argv.host; }
if (argv.port) { exports.config.port = argv.port; }

global.logger = require('tracer').colorConsole(config.log.transport);
