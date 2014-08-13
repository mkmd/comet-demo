var tools = require('../toolkit'),
    mixins = require('../mixins'),
    Class = require('classful');

exports.create = function (server) {
    var ObserversService = Class.create({
        extend: require('events').EventEmitter,
        singleton: true,

        constructor: function () {
            this.server = server;
            this.config = this.server.config.services.observers;
            this.observe = require('../observers').create(this.server, 'observers');
        },

        properties: {
            initialize: function () {
                this.server/// close connection not processed: chat can be runned locally - opening/closing without open/close connections
                    .on('observers.bind', this._onBind.bind(this))
                    .on('observers.unbind', this._onUnbind.bind(this));
            },

            integrity: function () {
                return this.observe.integrity();
            },

            _onBind: function (request) {
                if (!request.data.id){
                    return;
                }

                this.observe.add(request.connection.id, request.data.id);
            },

            _onUnbind: function (request) {
                if (!request.data.id && !request.data.all){
                    return;
                }

                this.observe.remove(request.connection.id, request.data.all ? null : request.data.id);
            }
        }
    });

    //ObserversService.prototype.extend(mixins.SendMixin('observers'));

    return ObserversService.getInstance();
}
