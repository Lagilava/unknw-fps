// Local ESM shim for the `eventery` package (a dependency of @miniplex/bucket).
// eventery only ships a CJS build; esm.sh (its usual CDN resolution path) is
// unreachable in some sandboxed/offline environments, matching the reasoning
// already applied to @dimforge/rapier3d-compat (see CLAUDE.md). This is a
// verbatim translation of node_modules/eventery/dist/eventery.cjs.prod.js
// (`exports.Event = Event` -> `export { Event }`), no logic changes.
function _arrayLikeToArray(arr, len) {
  if (len == null || len > arr.length) len = arr.length;
  for (var i = 0, arr2 = new Array(len); i < len; i++) arr2[i] = arr[i];
  return arr2;
}

function _arrayWithoutHoles(arr) {
  if (Array.isArray(arr)) return _arrayLikeToArray(arr);
}

function _iterableToArray(iter) {
  if (typeof Symbol !== "undefined" && iter[Symbol.iterator] != null || iter["@@iterator"] != null) return Array.from(iter);
}

function _unsupportedIterableToArray(o, minLen) {
  if (!o) return;
  if (typeof o === "string") return _arrayLikeToArray(o, minLen);
  var n = Object.prototype.toString.call(o).slice(8, -1);
  if (n === "Object" && o.constructor) n = o.constructor.name;
  if (n === "Map" || n === "Set") return Array.from(o);
  if (n === "Arguments" || /^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)) return _arrayLikeToArray(o, minLen);
}

function _nonIterableSpread() {
  throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
}

function _toConsumableArray(arr) {
  return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _unsupportedIterableToArray(arr) || _nonIterableSpread();
}

function _createForOfIteratorHelper(o, allowArrayLike) {
  var it = typeof Symbol !== "undefined" && o[Symbol.iterator] || o["@@iterator"];
  if (!it) {
    if (Array.isArray(o) || (it = _unsupportedIterableToArray(o)) || allowArrayLike && o && typeof o.length === "number") {
      if (it) o = it;
      var i = 0;
      var F = function () {};
      return {
        s: F,
        n: function () {
          if (i >= o.length) return {
            done: true
          };
          return {
            done: false,
            value: o[i++]
          };
        },
        e: function (e) {
          throw e;
        },
        f: F
      };
    }
    throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.");
  }
  var normalCompletion = true,
    didErr = false,
    err;
  return {
    s: function () {
      it = it.call(o);
    },
    n: function () {
      var step = it.next();
      normalCompletion = step.done;
      return step;
    },
    e: function (e) {
      didErr = true;
      err = e;
    },
    f: function () {
      try {
        if (!normalCompletion && it.return != null) it.return();
      } finally {
        if (didErr) throw err;
      }
    }
  };
}

function _classCallCheck(instance, Constructor) {
  if (!(instance instanceof Constructor)) {
    throw new TypeError("Cannot call a class as a function");
  }
}

function _toPrimitive(input, hint) {
  if (typeof input !== "object" || input === null) return input;
  var prim = input[Symbol.toPrimitive];
  if (prim !== undefined) {
    var res = prim.call(input, hint || "default");
    if (typeof res !== "object") return res;
    throw new TypeError("@@toPrimitive must return a primitive value.");
  }
  return (hint === "string" ? String : Number)(input);
}

function _toPropertyKey(arg) {
  var key = _toPrimitive(arg, "string");
  return typeof key === "symbol" ? key : String(key);
}

function _defineProperties(target, props) {
  for (var i = 0; i < props.length; i++) {
    var descriptor = props[i];
    descriptor.enumerable = descriptor.enumerable || false;
    descriptor.configurable = true;
    if ("value" in descriptor) descriptor.writable = true;
    Object.defineProperty(target, _toPropertyKey(descriptor.key), descriptor);
  }
}
function _createClass(Constructor, protoProps, staticProps) {
  if (protoProps) _defineProperties(Constructor.prototype, protoProps);
  if (staticProps) _defineProperties(Constructor, staticProps);
  Object.defineProperty(Constructor, "prototype", {
    writable: false
  });
  return Constructor;
}

function _defineProperty(obj, key, value) {
  key = _toPropertyKey(key);
  if (key in obj) {
    Object.defineProperty(obj, key, {
      value: value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  } else {
    obj[key] = value;
  }
  return obj;
}

var Event = /*#__PURE__*/function () {
  function Event() {
    _classCallCheck(this, Event);
    _defineProperty(this, "subscribers", new Set());
  }
  _createClass(Event, [{
    key: "onSubscribe",
    get: function get() {
      if (!this._onSubscribe) this._onSubscribe = new Event();
      return this._onSubscribe;
    }
  }, {
    key: "onUnsubscribe",
    get: function get() {
      if (!this._onUnsubscribe) this._onUnsubscribe = new Event();
      return this._onUnsubscribe;
    }
  }, {
    key: "subscribe",
    value: function subscribe(callback) {
      var _this$_onSubscribe,
        _this = this;
      this.subscribers.add(callback);
      (_this$_onSubscribe = this._onSubscribe) === null || _this$_onSubscribe === void 0 ? void 0 : _this$_onSubscribe.emit(callback);
      return function () {
        return _this.unsubscribe(callback);
      };
    }
  }, {
    key: "unsubscribe",
    value: function unsubscribe(callback) {
      var _this$_onUnsubscribe;
      this.subscribers["delete"](callback);
      (_this$_onUnsubscribe = this._onUnsubscribe) === null || _this$_onUnsubscribe === void 0 ? void 0 : _this$_onUnsubscribe.emit(callback);
    }
  }, {
    key: "clear",
    value: function clear() {
      if (this._onUnsubscribe) {
        var _iterator = _createForOfIteratorHelper(this.subscribers),
          _step;
        try {
          for (_iterator.s(); !(_step = _iterator.n()).done;) {
            var _callback = _step.value;
            this._onUnsubscribe.emit(_callback);
          }
        } catch (err) {
          _iterator.e(err);
        } finally {
          _iterator.f();
        }
      }
      this.subscribers.clear();
    }
  }, {
    key: "emit",
    value: function emit() {
      for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
        args[_key] = arguments[_key];
      }
      this.subscribers.forEach(function (callback) {
        return callback.apply(void 0, args);
      });
    }
  }, {
    key: "emitAsync",
    value: function emitAsync() {
      for (var _len2 = arguments.length, args = new Array(_len2), _key2 = 0; _key2 < _len2; _key2++) {
        args[_key2] = arguments[_key2];
      }
      return Promise.all(_toConsumableArray(this.subscribers).map(function (listener) {
        return listener.apply(void 0, args);
      }));
    }
  }]);
  return Event;
}();

export { Event };
