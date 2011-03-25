// Opera Wang, 2011/3/24
// GPL V3 / MPL
// Expression Search Filter
// MessageTextFilter didn't want me to extend it much, so I have to define mine.

var EXPORTED_SYMBOLS = ["ExperssionSearchFilter"];

let Cu = Components.utils;
let Ci = Components.interfaces;
let Cc = Components.classes;
Cu.import("resource://expressionsearch/log.js");
Cu.import("resource:///modules/quickFilterManager.js");
Cu.import("resource://expressionsearch/gmailuiParse.js");
Cu.import("resource:///modules/gloda/indexer.js");
let nsMsgSearchAttrib = Ci.nsMsgSearchAttrib;
let nsMsgSearchOp = Ci.nsMsgSearchOp;
let Application = Cc["@mozilla.org/steel/application;1"].getService(Ci.steelIApplication);

let ExperssionSearchFilter = {
  name: "expression",
  domId: "expression-search-textbox",
  
  // request to create virtual folder, set to the ExpressionSearchChrome when need to create
  latchQSFolderReq: 0,
  allTokens: "simple|from|f|to|t|subject|s|all|body|b|attachment|a|tag|label|l|status|u|is|i|before|be|after|af",

  appendTerms: function(aTermCreator, aTerms, aFilterValue) {
    if (aFilterValue.text) {
      try {
        if ( aFilterValue.text.toLowerCase().indexOf('g:') == 0 ) { // may get called when init with saved values in searchInput.
          return;
        }

        // check if in normal filter mode
        if ( 0 && aFilterValue.text ) {
          // Use normalFilter's appendTerms to create search term
          ExpressionSearchLog.logObject(QuickFilterBarMuxer.activeFilterer.filterValues,'QuickFilterBarMuxer.activeFilterer.filterValues',0);
          let normalFilterState = QuickFilterBarMuxer.activeFilterer.filterValues['text'];
          ExpressionSearchLog.logObject(normalFilterState,'normalFilterState',1);
          let originalText = normalFilterState.text;
          normalFilterState.text = aFilterValue.text;
          let normalFilter = QuickFilterManager.filterDefsByName['text'];
          normalFilter.appendTerms.apply(normalFilter, [aTermCreator, aTerms, normalFilterState]);
          normalFilterState.text = originalText;
          return;
        }
        
        // first remove trailing specifications if it's empty
        // then remove trailing ' and' but no remove of "f: and"
        let regExpReplace = new RegExp( '(?:^|\\s+)(?:' + ExperssionSearchFilter.allTokens + '):(?:\\(|)\\s*$', "i");
        let regExpSearch = new RegExp( '\\b(?:' + ExperssionSearchFilter.allTokens + '):\\s+and\\s*$', "i");
        var aSearchString = aFilterValue.text.replace(regExpReplace,'');
        if ( !regExpSearch.test(aSearchString) ) {
          aSearchString = aSearchString.replace(/\s+\and\s*$/i,'');
        }
        aSearchString.replace(/\s+$/,'');
        if ( aSearchString == '' ) {
          return;
        }
        var e = compute_expression(aSearchString);
        if ( ExperssionSearchFilter.latchQSFolderReq ) {
          let terms = aTerms.slice();
          ExperssionSearchFilter.createSearchTermsFromExpression(e,aTermCreator,terms);
          ExperssionSearchFilter.latchQSFolderReq.createQuickFolder.apply(ExperssionSearchFilter.latchQSFolderReq, [terms]);
          ExperssionSearchFilter.latchQSFolderReq = 0;
        } else {
          ExpressionSearchLog.log("Experssion Search Statements: "+expr_tostring_infix(e));
          ExperssionSearchFilter.createSearchTermsFromExpression(e,aTermCreator,aTerms);
        }
        return;
      } catch (err) {
        ExpressionSearchLog.logException(err);
      }
    }
  },

  domBindExtra: function(aDocument, aMuxer, aNode) {
    // -- platform-dependent emptytext setup
    let filterNode = aDocument.getElementById('qfb-qs-textbox');
    let quickKey = '';
    let attributeName = "emptytext"; // for 3.1
    if ( filterNode && typeof(Application)!='undefined' ) {
      if ( filterNode.hasAttribute("placeholder") )
        attributeName = "placeholder"; // for 3.3
      quickKey = filterNode.getAttribute(Application.platformIsMac ? "keyLabelMac" : "keyLabelNonMac");
      // now Ctrl+F will focus to our input, so remove the message in this one
      filterNode.setAttribute( attributeName, filterNode.getAttribute("emptytextbase").replace("#1", '') );
      // force to update the message
      filterNode.value = '';
    }
    aNode.setAttribute( attributeName, aNode.getAttribute("emptytextbase").replace("#1", quickKey) );
    // force an update of the emptytext now that we've updated it.
    aNode.value = "";
  },

  getDefaults: function() { // this function get called pretty early
    return {
      text: null,
    };
  },

  propagateState: function(aOld, aSticky) {
    return {
      // must clear state when create quick search folder, or recursive call happenes when aSticky.
      text: ( aSticky && !ExperssionSearchFilter.latchQSFolderReq )? aOld.text : null,
      //states: {},
    };
  },

  onCommand: function(aState, aNode, aEvent, aDocument) { // may get skipped when init, but appendTerms get called
    let ExpressionSearchChrome = {};
    if ( aDocument && aDocument.defaultView && aDocument.defaultView.window && aDocument.defaultView.window.ExpressionSearchChrome )
      ExpressionSearchChrome = aDocument.defaultView.window.ExpressionSearchChrome;
    
    let text = aNode.value.length ? aNode.value : null;
    aState = aState || {}; // or will be no search.
    let needSearch = false;
    if ( ExpressionSearchChrome.isEnter ) {
      // press Enter to select searchInput
      aNode.select();
      // if text not null and create qs folder return true
      if ( text && ExperssionSearchFilter.latchQSFolderReq ) {
        needSearch = true;
      }
    }
    if ( text != aState.text ) {
      aState.text = text;
      needSearch = true;
    }
    if ( !needSearch && ExpressionSearchChrome.isEnter && ExpressionSearchChrome.options && ExpressionSearchChrome.options.select_msg_on_enter ) // else the first message will be selected in reflectInDom
        ExpressionSearchChrome.selectFirstMessage(true);
    return [aState, needSearch];
  },

  // change DOM status, eg disabled, checked, etc.
  // by AMuxer.onActiveAllMessagesLoaded or reflectFiltererState
  reflectInDOM: function(aNode, aFilterValue,
                        aDocument, aMuxer,
                        aFromPFP) { //PFP: PostFilterProcess, the second value PFP returns
    // Update the text if it has changed (linux does weird things with empty
    //  text if we're transitioning emptytext to emptytext)
    let desiredValue = "";
    if ( typeof(aFilterValue) != 'undefined' && typeof(aFilterValue.text) != 'undefined' )
      desiredValue = aFilterValue.text;
    if ( aNode.value != desiredValue && !aFromPFP )
      aNode.value = desiredValue;

    let panel = aDocument.getElementById("qfb-text-search-upsell");
    if (aFromPFP == "upsell") {
      let searchString = ExperssionSearchFilter.expression2gloda(aFilterValue.text);
      let line1 = aDocument.getElementById("qfb-upsell-line-one");
      let line2 = aDocument.getElementById("qfb-upsell-line-two");
      line1.value = line1.getAttribute("fmt").replace("#1", searchString);
      line2.value = line2.getAttribute("fmt").replace("#1", searchString);
      if (panel.state == "closed" && aDocument.commandDispatcher.focusedElement == aNode.inputField)
        panel.openPopup(aNode, "after_start", -7, 7, false, true);
      return;
    }

    if (panel.state != "closed")
      panel.hidePopup();

    let ExpressionSearchChrome = {};
    if ( aDocument && aDocument.defaultView && aDocument.defaultView.window && aDocument.defaultView.window.ExpressionSearchChrome )
      ExpressionSearchChrome = aDocument.defaultView.window.ExpressionSearchChrome;
    ExpressionSearchChrome.selectFirstMessage(ExpressionSearchChrome.isEnter && ExpressionSearchChrome.options.select_msg_on_enter);
  },

  postFilterProcess: function(aState, aViewWrapper, aFiltering) {
    // If we're not filtering, not filtering on text, there are results, or
    //  gloda is not enabled so upselling makes no sense, then bail.
    // (Currently we always return "nosale" to make sure our panel is closed;
    //  this might be overkill but unless it becomes a performance problem, it
    //  keeps us safe from weird stuff.)
    if (!aFiltering || !aState || !aState.text || !aViewWrapper || aViewWrapper.dbView.numMsgsInView || !GlodaIndexer.enabled)
      return [aState, "nosale", false];

    // since we're filtering, filtering on text, and there are no results, tell
    //  the upsell code to get bizzay
    return [aState, "upsell", false];
  },
  
  addSearchTerm: function(aTermCreator, searchTerms, str, attr, op, is_or, grouping) {
    var term,value;
    term = aTermCreator.createTerm();
    term.attrib = attr;
    value = term.value;
    // This is tricky - value.attrib must be set before actual values, from searchTestUtils.js 
    value.attrib = attr;

    if (attr == nsMsgSearchAttrib.JunkPercent)
      value.junkPercent = str;
    else if (attr == nsMsgSearchAttrib.Priority)
      value.priority = str;
    else if (attr == nsMsgSearchAttrib.Date)
      value.date = str;
    else if (attr == nsMsgSearchAttrib.MsgStatus || attr == nsMsgSearchAttrib.FolderFlag || attr == nsMsgSearchAttrib.Uint32HdrProperty)
      value.status = str;
    else if (attr == nsMsgSearchAttrib.MessageKey)
      value.msgKey = str;
    else if (attr == nsMsgSearchAttrib.Size)
      value.size = str;
    else if (attr == nsMsgSearchAttrib.AgeInDays)
      value.age = str;
    else if (attr == nsMsgSearchAttrib.Size)
      value.size = str;
    else if (attr == nsMsgSearchAttrib.Label)
      value.label = str;
    else if (attr == nsMsgSearchAttrib.JunkStatus)
      value.junkStatus = str;
    else if (attr == nsMsgSearchAttrib.HasAttachmentStatus)
      value.status = nsMsgMessageFlags.Attachment;
    else
      value.str = str;

    term.value = value;
    term.op = op;
    term.booleanAnd = !is_or;
    
    if (attr == nsMsgSearchAttrib.Custom)
      term.customId = aCustomId;
    else if (attr == nsMsgSearchAttrib.OtherHeader)
      term.arbitraryHeader = aArbitraryHeader;
    else if (attr == nsMsgSearchAttrib.HdrProperty || attr == nsMsgSearchAttrib.Uint32HdrProperty)
      term.hdrProperty = aHdrProperty;

    //ExpressionSearchLog.log("Expression Search: "+term.termAsString);
    searchTerms.push(term);
  },

  get_key_from_tag: function(myTag) {
    var tagService = Cc["@mozilla.org/messenger/tagservice;1"].getService(Components.interfaces.nsIMsgTagService); 
    var tagArray = tagService.getAllTags({});
    var unique = undefined;
    // consider two tags, one is "ABC", the other is "ABCD", when searching for "AB", perfect is return both.
    // however, that need change the token tree.
    // so here I just return the best fit "ABC".
    var myTagLen = myTag.length;
    var lenDiff = 10000000; // big enough?
    for (var i = 0; i < tagArray.length; ++i) {
        var tag = tagArray[i].tag;
        var key = tagArray[i].key;
        tag = tag.toLowerCase();
        if (tag.indexOf(myTag) >= 0 && ( tag.length-myTagLen < lenDiff ) ) {
          unique = key;
          lenDiff = tag.length-myTagLen;
          if ( lenDiff == 0 ) {
            break;
          }
        }
    }
    if (unique != undefined) 
        return unique;
    else
        return "..unknown..";
  },
  
  
  expression2gloda: function(searchValue) {
    searchValue = searchValue.replace(/^g:\s*/i,'');
    let regExp = new RegExp( "(?:^|\\b)(?:" + this.allTokens + "):", "g");
    searchValue = searchValue.replace(regExp,'');
    searchValue = searchValue.replace(/(?:\b|^)(?:and|or)(?:\b|$)/g,'').replace(/[()]/g,'');
    return searchValue;
  },
  
  convertExpression: function(e,aTermCreator,searchTerms,was_or) {
    var is_not = false;
    if (e.kind == 'op' && e.tok == '-') {
      if (e.left.kind != 'spec') {
        ExpressionSearchLog.log('Exression Search: unexpected expression tree',1);
        return;
      }
      e = e.left;
      is_not = true;
    }
    if (e.kind == 'spec') {
      var attr;
      if (e.tok == 'from') attr = nsMsgSearchAttrib.Sender;
      else if (e.tok == 'to') attr = nsMsgSearchAttrib.ToOrCC;
      else if (e.tok == 'subject' || e.tok == 'simple') attr = nsMsgSearchAttrib.Subject;
      else if (e.tok == 'body') attr = nsMsgSearchAttrib.Body;
      else if (e.tok == 'attachment') attr = nsMsgSearchAttrib.HasAttachmentStatus;
      else if (e.tok == 'status') attr = nsMsgSearchAttrib.MsgStatus;
      else if (e.tok == 'before' || e.tok == 'after') attr = nsMsgSearchAttrib.Date;
      else if (e.tok == 'tag') {
        e.left.tok = this.get_key_from_tag(e.left.tok);
        attr = nsMsgSearchAttrib.Keywords;
      } else if (e.tok == 'calc' ) {
        return;
      } else {ExpressionSearchLog.log('Exression Search: unexpected specifier',1); return; }
      var op = is_not ? nsMsgSearchOp.DoesntContain:nsMsgSearchOp.Contains;
      if (e.left.kind != 'str') {
        ExpressionSearchLog.log('Exression Search: unexpected expression tree',1);
        return;
      }
      if (e.tok == 'attachment') {
        if (!/^[Yy1]/.test(e.left.tok)) {
          // looking for no attachment; reverse is_noto.
          is_not = !is_not;
        }
      }
      if ( attr == nsMsgSearchAttrib.Date) {
        // is before: before => false, true: true
        // is after: after   => false, false: false
        // isnot before: after => true, ture: false
        // isnot after: before => true, false: true
        op = (is_not^(e.tok=='before')) ? nsMsgSearchOp.IsBefore : nsMsgSearchOp.IsAfter;
        var date;
        try {
          var inValue = e.left.tok;
          date = new Date(inValue);
          e.left.tok = date.getTime()*1000; // why need *1000, I don't know ;-)
          if ( isNaN(e.left.tok) ) {
            ExpressionSearchLog.log('Expression Search: date '+ inValue + " is not valid",1);
            return;
          }
        } catch (err) {
          ExpressionSearchLog.logException(err);
          return;
        }
      }
      if (e.tok == 'status') {
        if (/^Rep/i.test(e.left.tok))
          e.left.tok = nsMsgMessageFlags.Replied;
        else if (/^Rea/i.test(e.left.tok))
          e.left.tok = nsMsgMessageFlags.Read;
        else if (/^M/i.test(e.left.tok))
          e.left.tok = nsMsgMessageFlags.Marked;
        else if (/^F/i.test(e.left.tok))
          e.left.tok = nsMsgMessageFlags.Forwarded;
        else if (/^A/i.test(e.left.tok))
          e.left.tok = nsMsgMessageFlags.Attachment;
        else if (/^UnR/i.test(e.left.tok)) {
          e.left.tok = nsMsgMessageFlags.Read;
          is_not = !is_not;
        } else {
          ExpressionSearchLog.log('Exression Search: unknown status '+e.left.tok,1);
          return;
        }
      }
      if (e.tok == 'attachment' || e.tok == 'status') {
        op = is_not ? nsMsgSearchOp.Isnt : nsMsgSearchOp.Is;
      }
      
      this.addSearchTerm(aTermCreator, searchTerms, e.left.tok, attr, op, was_or);
      return;
    }
    if (e.left != undefined)
      this.convertExpression(e.left, aTermCreator, searchTerms, was_or);
    if (e.right != undefined)
      this.convertExpression(e.right, aTermCreator, searchTerms, e.kind == 'op' && e.tok == 'or');
  },
  createSearchTermsFromExpression: function(e,aTermCreator,searchTerms) {
    // start converting the search expression.  Every search term
    // has an and or or field in it.  My current understanding is
    // that it's what this term should be preceded by.  Of course it
    // doesn't apply to the first term, but it appears the search
    // dialog uses it to set the radio button.  The dialog cannot
    // possibly deal with anything but expressions that are all one
    // or the other logical operator, but at least if the user gives
    // us an expression that is only or's, let's use the or value
    // for the type of the first term (second param to
    // convertExpression).  You can prove that the top expression
    // node will only be an 'or' if all operators are ors.
    this.convertExpression(e,aTermCreator,searchTerms, e.kind=='op' && e.tok=='or');

    // Add grouping attributes.  Look for the beginning and end of
    // each disjunct and mark it with grouping
    var firstDJTerm = -1;
    var priorTerm = null;

    for (var i = 0; i < searchTerms.length; i++) {
      if (!searchTerms[i].booleanAnd) {
        if (priorTerm != null) {
          firstDJTerm = i - 1;
          priorTerm.beginsGrouping = true;
        }
      } else {
        if (firstDJTerm != -1) {
          priorTerm.endsGrouping = true;
          firstDJTerm = -1;
        }
      }
      priorTerm = searchTerms[i];
    }
    if (firstDJTerm != -1) {
      priorTerm.endsGrouping = true;
      firstDJTerm = -1;
    }
    function getSearchTermString(searchTerms) {
      let condition = "";
      searchTerms.forEach( function(searchTerm, index, array) {
        if (index > 0) condition += " ";
        if (searchTerm.matchAll)
          condition += "ALL";
        else {
          condition += searchTerm.booleanAnd ? "AND" : "OR";
          condition += searchTerm.beginsGrouping && !searchTerm.endsGrouping ? " (" : "";
        }
        condition += " (" + searchTerm.termAsString + ")";
        // ")" may not balanced with "(", but who cares
        condition += searchTerm.endsGrouping && !searchTerm.beginsGrouping ? " )" : "";
      } );
      return condition;
    }
    ExpressionSearchLog.log("Experssion Search Terms: "+getSearchTermString(searchTerms));
    return null;
  },
  
} // end of ExperssionSearchFilter define
QuickFilterManager.defineFilter(ExperssionSearchFilter);
QuickFilterManager.textBoxDomId = ExperssionSearchFilter.domId;
