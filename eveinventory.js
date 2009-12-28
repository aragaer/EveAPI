const Cc = Components.classes;
const Ci = Components.interfaces;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");

var gOS, gDB;

const PreloadedTypes = {};
const PreloadedGroups = {};
const PreloadedCategories = {};

const IF = {
    getPreloaded:       function (storage, construct) {
        return function (id) {
            if (!storage['itm' + id])
                storage['itm' + id] = construct(id);
            return storage['itm' + id];
        }
    },

    getDataById:        function (obj, stmname) {
        return function (id) {
            var result = {};
            var stm = obj[stmname];
            try {
                stm.params.id = id;
                stm.step();
                [result[col] = stm.row[col] for (col in columnList(stm))];
            } catch (e) {
                dump(e.toString()+"\n");
            } finally {
                stm.reset();
            }
            return result;
        }
    },

    makeCategoryObject: function (id) new eveitemcategory(id),
    makeGroupObject:    function (id) new eveitemgroup(id),
    makeTypeObject:     function (id) new eveitemtype(id),
};
IF.getItemCategory  = IF.getPreloaded(PreloadedCategories, IF.makeCategoryObject);
IF.getItemGroup     = IF.getPreloaded(PreloadedGroups, IF.makeGroupObject);
IF.getItemType      = IF.getPreloaded(PreloadedTypes, IF.makeTypeObject);

const DataStatements = {
    getCatData:     'select categoryName from static.invCategories where categoryID=:id;',
    getGrpData:     'select groupName, categoryID from static.invGroups where groupID=:id;',
    getTypeData:    'select typeName, groupID from static.invTypes where typeID=:id;',
};

function StmName(FuncName) "_"+FuncName+"Stm";

function eveitemcategory(catid) {
    this._id = catid;
    let {categoryName: name} = IF.getCatData(catid);
    this._name = name;
}

eveitemcategory.prototype = {
    classDescription:   "EVE item category",
    classID:            Components.ID("{ef3555fb-be5d-43c9-83ab-d3e8d5432f43}"),
    contractID:         "@aragaer/eve/item-category;1",
    QueryInterface:     XPCOMUtils.generateQI([Ci.nsIEveItemCategory]),

    get id()            this._id,
    get name()          this._name,
};

function eveitemgroup(groupid) {
    this._id = groupid;
    let {groupName: name, categoryID: catid} = IF.getGrpData(groupid);
    this._name = name;
    this._category = IF.getItemCategory(catid);
}

eveitemgroup.prototype = {
    classDescription:   "EVE item group",
    classID:            Components.ID("{5e922507-10b0-4fee-b8df-9f95df29a28a}"),
    contractID:         "@aragaer/eve/item-group;1",
    QueryInterface:     XPCOMUtils.generateQI([Ci.nsIEveItemGroup]),

    get id()            this._id,
    get name()          this._name,
    get category()      this._category,
};

function eveitemtype(typeid) {
    this._id = typeid;
    let {typeName: name, groupID: grpid} = IF.getTypeData(typeid);
    this._name = name;
    this._group = IF.getItemGroup(grpid);
}

eveitemtype.prototype = {
    classDescription:   "EVE item type",
    classID:            Components.ID("{fb6bfcfe-5f16-4dc1-a78d-de5e4b766a26}"),
    contractID:         "@aragaer/eve/item-type;1",
    QueryInterface:     XPCOMUtils.generateQI([Ci.nsIEveItemType]),

    get id()            this._id,
    get name()          this._name,
    get group()         this._group,
};

function eveinventory() {
    gOS = Cc["@mozilla.org/observer-service;1"].getService(Ci.nsIObserverService);
    gDB = Cc["@aragaer/eve/db;1"].getService(Ci.nsIEveDBService);
}

eveinventory.prototype = {
    classDescription:   "EVE Inventory Service",
    classID:            Components.ID("{e5dc59a4-217e-46da-8c9f-d6de36df2d3f}"),
    contractID:         "@aragaer/eve/inventory;1",
    QueryInterface:     XPCOMUtils.generateQI([Ci.nsIEveInventoryService, Ci.nsIObserver]),
    _xpcom_categories:  [{
        category: "app-startup",
        service: true
    }],

    observe:        function (aSubject, aTopic, aData) {
        switch (aTopic) {
        case 'app-startup':
            gOS.addObserver(this, 'eve-db-init', false);
            for (i in DataStatements)
                IF[i] = IF.getDataById(IF, StmName(i));
            break;
        case 'eve-db-init':
            this._conn = gDB.getConnection();
            if (!this._conn.tableExists('assets'))
                this._conn.createTable('assets',
                        'id integer, typeID integer, owner integer, ' +
                        'location integer, count integer, flag integer, ' +
                        'singleton integer, container integer, primary key (id)');

            for (i in DataStatements)
                IF[StmName(i)] = this._conn.createStatement(DataStatements[i]);
            break;
        }
    },

    getItemCategory: IF.getItemCategory,
    getItemGroup:    IF.getItemGroup,
    getItemType:     IF.getItemType,
};

var components = [eveinventory, eveitemcategory, eveitemgroup, eveitemtype];
function NSGetModule(compMgr, fileSpec) {
    return XPCOMUtils.generateModule(components);
}

function columnList(stm) {
    for (let i = 0; i < stm.columnCount; i++)
        yield stm.getColumnName(i);
}

