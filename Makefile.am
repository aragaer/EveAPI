#!/bin/sh
# @configure_input@
include $(top_srcdir)/xpt.mk
JS_FILES=eveapirequester.js dbwrapper.js eveapiservice.js evecharacter.js
XPT_FILES=nsIEveApiRequester.xpt nsIEveApiService.xpt nsIEveDBService.xpt
XPT_FILES+=EveConstants.xpt nsIEveInventoryService.xpt
XPT_FILES+=nsIEveHRManager.xpt
XPT_FILES+=nsIEveControlTower.xpt
JS_FILES+=controltower.js
JS_FILES+=hr.js
JS_FILES+=eveassets.js
JS_FILES+=eveinventory.js
comp_DATA=$(JS_FILES) $(XPT_FILES)
pref_DATA=api_pref.js
