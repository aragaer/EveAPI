const Cc = Components.classes;
const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");
var gOS;

function InventoryCallback() {
    gOS = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
    this._conn = null;
}

InventoryCallback.prototype = {
    classDescription: "EVE API Assets Callback",
    classID:          Components.ID("{79f28e62-ed5d-4e4a-9c0f-74fcf0b218f8}"),
    contractID:       "@aragaer/eve/callbacks/inventory;1",
    QueryInterface:   XPCOMUtils.generateQI([Ci.nsIObserver]),
    _xpcom_categories: [{
        category:   'app-startup',
        service:    true
    }],

    observe:        function (aSubject, aTopic, aData) {
        dump('Got '+aTopic+' event in eve assets\n');
        switch (aTopic) {
        case 'app-startup':
            gOS.addObserver(this, 'eve-data', false);
            gOS.addObserver(this, 'eve-db-init', false);
            break;
        case 'eve-data':
            dump("The data is ["+aData+"] the subject is "+aSubject.wrappedJSObject.doc+"\n");
            switch (aData) {
                case 'charassets':
                case 'corpassets':
                    this._process(aSubject);
                    return;
                default:
                    break;
            }
            break;
        case 'eve-db-init':
            var db = Cc["@aragaer/eve/db;1"].getService(Ci.nsIEveDBService);
            dump("DB service is initialized in assets... store connection now\n");
            this._conn = db.getConnection();
            if (!this._conn.tableExists('assets'))
                this._conn.createTable('assets',
                        'id integer, typeID integer, owner integer, ' +
                        'location integer, count integer, flag integer, ' +
                        'singleton integer, container integer, primary key (id)');
            break;
        }
    },

    _process:       function (data) {
        var rowsets, rowset;
        var doc = data.wrappedJSObject.doc;
        var aux = data.wrappedJSObject.aux;
        var replaceItemStm = this._conn.createStatement(
                'replace into assets (id, typeID, owner, location, count, ' +
                'flag, singleton, container) ' +
                'values (:id, :type_id, :owner, :location, :count, :flag, :singleton, :container);'
        );
        try {
            rowsets = doc.evaluate('/eveapi/result/rowset', doc, null, 0, null);
        } catch (e) {
            dump("error in AssetsCallback:"+e.toString()+"\n");
        }
        while (rowset = rowsets.iterateNext()) {
            dump("Processing rowset="+rowset+"!\n");
            this._processAssetList(aux.wrappedJSObject.owner, rowset, replaceItemStm, doc);
        }
    },

    _processAssetList:  function (owner, node, stm, doc) {
        var row, rows, container;
         try {
            rows = doc.evaluate('child::row', node, null, 0, null);
        } catch (e) {
            dump("error in AssetsCallback:"+e.toString()+"\n");
            return;
        }
        container = node.parentNode.getAttribute('itemID');
        while (row = rows.iterateNext()) {
            var my_data = {};
            ['itemID', 'locationID', 'typeID', 'quantity', 'flag', 'singleton'].
                forEach(function (field) {
                    my_data[field] = row.getAttribute(field);
                });
            stm.params.id       = my_data.itemID;
            stm.params.type_id  = my_data.typeID;
            stm.params.owner    = owner;
            container
                ? stm.params.container = container
                : stm.params.location  = my_data.locationID;
            stm.params.count    = my_data.quantity;
            stm.params.flag     = my_data.flag || 0;
            stm.params.singleton= my_data.singleton || 0;
            stm.executeAsync();
            var childs = doc.evaluate('child::rowset', row, null, 0, null).iterateNext();
            if (childs)
                this._processAssetList(owner, childs, stm, doc);
        }
    },
}

var components = [InventoryCallback];
function NSGetModule(compMgr, fileSpec) {
    return XPCOMUtils.generateModule(components);
}
