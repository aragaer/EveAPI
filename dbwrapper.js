const Cc = Components.classes;
const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

function dbwrapper() {
    var file = Cc["@mozilla.org/file/directory_service;1"].
            getService(Ci.nsIProperties).get('ProfD', Ci.nsIFile);
    file.append('data');
    if (!file.exists())
        file.create(file.DIRECTORY_TYPE, 0777);
 
    file.append('api.db');
    if (!file.exists())
        file.create(file.NORMAL_FILE_TYPE, 0700);

    this.conn = Cc["@mozilla.org/storage/service;1"].
            getService(Ci.mozIStorageService).
            openDatabase(file);
 
    this._initLocalDB();

    try {
        this._openStaticDB();
    } catch (e) {
        dump(e.toString()+"\n");
        dump(this.conn.lastErrorString+"\n");
    }

    dump("DB service initialized\n");
}

dbwrapper.prototype = {
    classDescription:   "EVE Online static dump",
    classID:            Components.ID("{66575bef-61c0-4ea3-9c34-17c10870e6a9}"),
    contractID:         "@aragaer/eve/db;1",
    QueryInterface:     XPCOMUtils.generateQI([Ci.nsIEveDBService]),
    _xpcom_categories: [{
        category: "xpcom-startup",
        service: true
    }],

    get connection()	this.conn,

    _initLocalDB:       function () {
        this.conn.executeSimpleSQL("PRAGMA synchronous = OFF");
        this.conn.executeSimpleSQL("PRAGMA temp_store = MEMORY");
        if (!this.conn.tableExists('characters'))
            this.conn.createTable('characters',
                    'name char, id integer, account integer, ' +
                    'corporation integer, primary key (id)');
    },

    _openStaticDB:      function () {
        var static = Cc["@mozilla.org/preferences-service;1"].
            getService(Ci.nsIPrefBranch).getCharPref("eve.static_dump_path");
        this.conn.executeSimpleSQL("attach database '"+static+"' as static\n")
    },
}

var components = [dbwrapper];
function NSGetModule(compMgr, fileSpec) {
    return XPCOMUtils.generateModule(components);
}

