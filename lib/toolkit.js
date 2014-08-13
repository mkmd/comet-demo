
var Events = require('events');

exports.common = function () {
    return {
        merge: function (object) {
            var i = 1,
                ln = arguments.length,
                arg,
                key, value;

            object = object || {};

            for (; i < ln; i++) {
                if (!(arg = arguments[i])) { continue; }

                for (key in arg) {
                    if (arg.hasOwnProperty(key)) {
                        value = arg[key];

                        if (exports.type.isObject(value)) {
                            if (exports.type.isObject(object[key])) {
                                exports.common.merge(object[key], value);
                            }
                            else {
                                object[key] = exports.common.clone(value);
                            }
                        }
                        else {
                            object[key] = value;
                        }
                    }
                }
            }

            return object;
        },

        clone: function (value) {
            function _merge(to, from) {
                var list = true,
                    i;

                for (i in {toString: 1}) { list = false; }

                if (list) {
                    list = ['hasOwnProperty', 'valueOf', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', 'toString', 'constructor'];
                    _merge = function (to, from) {
                        var j, k;
                        for (j = list.length; j--;) {
                            k = list[j];
                            if (from.hasOwnProperty(k)) {
                                to[k] = from[k];
                            }
                        }
                    };
                    _merge(to, from);
                }
                else {
                    _merge = function () { };
                }
            }

            if (value === null || value === undefined) { return value; }

            if (value.nodeType && value.cloneNode) { return value.cloneNode(true); }

            var type = Object.prototype.toString.call(value);

            if (type === '[object Date]') { return new Date(value.getTime()); }

            var i, clone, key;

            if (type === '[object Array]') {
                i = value.length;

                clone = [];

                while (i--) { clone[i] = exports.common.clone(value[i]); }
            }

            else if (type === '[object Object]' && value.constructor === Object) {
                clone = {};

                for (key in value) { clone[key] = exports.common.clone(value[key]); }

                _merge(clone, value);
            }

            return clone || value;
        },

        getJSON: function (value) {
            if (!value) {
                return;
            }

            try {
                return JSON.parse(value);
            } catch (e) {
                return value;
            }
        }
    }
}();

exports.type = function () {
    return {
        //определить тип
        type: function (value) {
            if (value === null) { return 'null'; }

            var type = typeof value;

            if (type === 'undefined' || type === 'string' || type === 'number' || type === 'boolean') { return type; }

            var typeToString = Object.prototype.toString.call(value);

            switch (typeToString) {
                case '[object Array]':
                    return 'array';
                case '[object Date]':
                    return 'date';
                case '[object Boolean]':
                    return 'boolean';
                case '[object Number]':
                    return 'number';
                case '[object RegExp]':
                    return 'regexp';
            }

            if (type === 'function') { return 'function'; }

            if (type === 'object') {
                if (value.nodeType !== undefined) {
                    if (value.nodeType === 3) {
                        return (/\S/).test(value.nodeValue) ? 'textnode' : 'whitespace';
                    }
                    else {
                        return 'element';
                    }
                }

                return 'object';
            }

            throw new Error('Failed to determine the type of the specified value "' + value + '"');
        },

        isNull: function (value) {
            return value === null || value === undefined;
        },

        isEmpty: function (value) {
            return (value === null) || (value === undefined) || value === '' || (Array.isArray(value) && !value.length);
        },

        isBoolean: function (value) {
            return typeof value === 'boolean';
        },

        isString: function (value) {
            return typeof value === 'string';
        },

        isArray: Array.isArray || function (value) {
            return Object.prototype.toString.call(value) === '[object Array]';
        },

        isNumeric: function (value) {
            return !isNaN(parseFloat(value)) && isFinite(value);
        },

        isNumber: function (value) {
            return typeof value === 'number' && isFinite(value);
        },

        isObject: (Object.prototype.toString.call(null) === '[object Object]')
            ? function (value) {
            return value !== null && value !== undefined &&
                Object.prototype.toString.call(value) === '[object Object]' && value.ownerDocument === undefined;
        }
            : function (value) {
            return Object.prototype.toString.call(value) === '[object Object]';
        },

        isFunction: function (value) {
            return Object.prototype.toString.call(value) === '[object Function]';
        },

        isDate: function (value) {
            return Object.prototype.toString.call(value) === '[object Date]';
        },

        isScalar: function (value) {
            var type = typeof value;
            return type === 'string' || type === 'number' || type === 'boolean';
        },

        isIterable: function (value) {
            return (value && typeof value !== 'string') ? value.length !== undefined : false;
        },

        isJSON: function (value/*, parsed*/) {
            try {
                JSON.parse(value);
                return true;
            } catch (e) {
                return false;
            }
        }
    }
}();

exports.fn = function () {
    return {
        devnull: function () { },

        arguments: function (offset) {
            return Array.prototype.slice.call(arguments.callee.caller.arguments, offset || 0);
        },

        gather: function (callback) {
            var fn = function (callback) {
                this.callback = callback;
                this.items = this.delayed = 0;
                this.results = [];
                this.stop = false;
            };

            fn.prototype = {
                add:   function (with_fn) {
                    if (this.stop) { return; }

                    var self = this;
                    this.items++;
                    var id = this.items - 1;
                    var args = arguments;
                    var fn = function () {
                        var arguments_ = arguments;

                        if (args.length == 1 && exports.type.isFunction(with_fn)) {
                            with_fn.apply(this, arguments);
                        } else if (args.length) {
                            arguments_ = Array.prototype.slice.call(args).concat(Array.prototype.slice.call(arguments_));
                        }

                        self.check(id, arguments_);
                    }

                    return fn;
                },

                check: function (id, arguments_) {
                    if (this.stop) { return; }

                    this.results[id] = arguments_;
                    this.items--;
                    if (this.items == 0) { this.apply(); }
                },

                apply: function () {
                    if (this.stop) { return; }

                    this.callback.apply(this, this.results);
                },

                stop:  function () {
                    this.stop = true;
                },

                count: function () {
                    return this.items;
                }
            };

            return new fn(callback);
        },

        emit: function (fn) {
            var emitter = new Events.EventEmitter();

            var args = Array.prototype.slice.call(arguments, 2);
            args.unshift(emitter);
            process.nextTick(function () { fn.apply(this, args); }.bind(this));

            return emitter;
        },

        handle: function (fn) {
            return function (err, data) {
                if (err) {
                    logger.error(err);
                    if (this.constructor.name == 'EventEmitter') {
                        this.emit('error', err);
                    }
                    return;
                }

                if (exports.type.isFunction(fn)) { return fn.call(this, data); } //fn(data);

                if (this.constructor.name == 'EventEmitter') { return this.emit(exports.type.isString(fn) ? fn : 'success', data); }
            };
        },

        bubble: function (event) {
            return function () {
                this.emit.apply(this, [event].concat(Array.prototype.slice.call(arguments)));
            }
        }
    }
}();

exports.iter = function () {
    return {
        keys: function (iterable) {
            var keys = [];
            for (var i in iterable) { keys.push(i); }
            return keys;
        },

        unique: function (arr) {
            var o = {}, i, l = arr.length, r = [];
            for (i = 0; i < l; i += 1) o[arr[i]] = arr[i];
            for (i in o) r.push(o[i]);

            return r;
        },

        diff: function (a, b) {
            if (!Array.isArray(a) || !Array.isArray(b)) { return []; }

            var more = a.length > b.length ? a : b;
            var less = a.length > b.length ? b : a;
            return more.filter(function (value) { return !(less.indexOf(value) > -1); });
        },

        contains: function (iterable, value) {
            for (var k in iterable) {
                if (iterable[k] == value) { return true; }
            }

            return false;
        }
    }
}();

exports.string = function () {
    return {
        ucfirst: function (str) {
            return str.charAt(0).toUpperCase() + str.slice(1);
        },

        ucwords: function (str) {
            str = str.split(' ');
            exports.fn.map(str, exports.string.ucfirst);
            return str.join(' ');
        },

        camelCase: function (str, prefix) {
            return prefix + str.split(/[ _\-\.]/).map(exports.string.ucfirst).join('');
        },

        uuid: function (bits) {
            var chars, rand, i, ret,
                chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

            ret = '';

            // in v8, Math.random() yields 32 pseudo-random bits (in spidermonkey it gives 53)
            while (bits > 0) {
                rand = Math.floor(Math.random() * 0x100000000); // 32-bit integer
                // base 64 means 6 bits per character, so we use the top 30 bits from rand to give 30/6=5 characters.
                for (i = 26; i > 0 && bits > 0; i -= 6, bits -= 6) ret += chars[0x3F & rand >>> i];
            }

            return ret;
        },

        guid: function(){
            /// require('node-uuid')
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8);
                return v.toString(16);
            });
            //require('crypto').randomBytes(16).toString('base64')
            /*var S4 = function() {
                return (((1+Math.random())*0x10000)|0).toString(16).substring(1);
            };
            return (S4()+S4()+"-"+S4()+"-"+S4()+"-"+S4()+"-"+S4()+S4()+S4());*/
        },

        random: function random(bits) {
            var chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXTZabcdefghiklmnopqrstuvwxyz";
            var randomstring = '';
            for (var i = 0; i < bits; i++) {
                var rnum = Math.floor(Math.random() * chars.length);
                randomstring += chars.substring(rnum, rnum + 1);
            }
            return randomstring;
        }
    };
}();

exports.time = function () {
    return {
        micro: function microtime(get_as_float) {
            var now = new Date().getTime() / 1000;
            var s = parseInt(now, 10);

            return (get_as_float) ? now : (Math.round((now - s) * 1000) / 1000) + ' ' + s;
        },

        stamp: function(){
            return Math.round(Date.now() / 1000);
        }
    };
}();
