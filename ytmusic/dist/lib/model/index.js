"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelType = void 0;
const AccountModel_1 = __importDefault(require("./AccountModel"));
const ConfigModel_1 = __importDefault(require("./ConfigModel"));
const EndpointModel_1 = __importDefault(require("./EndpointModel"));
const MusicItemModel_1 = __importDefault(require("./MusicItemModel"));
const PlaylistModel_1 = __importDefault(require("./PlaylistModel"));
const SearchModel_1 = __importDefault(require("./SearchModel"));
var ModelType;
(function (ModelType) {
    ModelType["Account"] = "Account";
    ModelType["Config"] = "Config";
    ModelType["Endpoint"] = "Endpoint";
    ModelType["Playlist"] = "Playlist";
    ModelType["Search"] = "Search";
    ModelType["MusicItem"] = "MusicItem";
})(ModelType || (exports.ModelType = ModelType = {}));
const MODEL_TYPE_TO_CLASS = {
    [ModelType.Account]: AccountModel_1.default,
    [ModelType.Config]: ConfigModel_1.default,
    [ModelType.Endpoint]: EndpointModel_1.default,
    [ModelType.Playlist]: PlaylistModel_1.default,
    [ModelType.Search]: SearchModel_1.default,
    [ModelType.MusicItem]: MusicItemModel_1.default
};
class Model {
    static getInstance(type) {
        if (MODEL_TYPE_TO_CLASS[type]) {
            return new MODEL_TYPE_TO_CLASS[type]();
        }
        throw Error(`Model not found for type ${String(ModelType)}`);
    }
}
exports.default = Model;
//# sourceMappingURL=index.js.map