var codediff = (function() {

var differ = function(beforeText, afterText, userParams) {
  var defaultParams = {
    contextSize: 3,
    language: null,
    beforeName: "Before",
    afterName: "After"
  };

  this.params = $.extend({}, defaultParams, userParams);

  this.beforeLines = beforeText ? difflib.stringAsLines(beforeText) : [];
  this.afterLines = afterText ? difflib.stringAsLines(afterText) : [];
  var sm = new difflib.SequenceMatcher(this.beforeLines, this.afterLines);
  this.opcodes = sm.get_opcodes();

  this.suppressCharDiffs_ = !(
      differ.suitableForHighlighting_(this.beforeLines) &&
      differ.suitableForHighlighting_(this.afterLines));

  if (this.params.language) {
    if (!this.suppressCharDiffs_) {
      var lang = this.params.language;
      this.beforeLinesHighlighted = differ.highlightText_(beforeText, lang);
      this.afterLinesHighlighted = differ.highlightText_(afterText, lang);
    } else {
      this.params.language = null;
    }
  }
};

differ.prototype.maxLineNumber = function() {
  return Math.max(this.beforeLines.length, this.afterLines.length);
};

/**
 * Check for long lines which might make highlight.js hang.
 * @param {Array.string>} lines The lines which might be highlighted.
 */
differ.suitableForHighlighting_ = function(lines) {
  var MAX_LINE_LENGTH = 1000;
  for (var i = 0; i < lines.length; i++) {
    if (lines[i].length > MAX_LINE_LENGTH) {
      return false;
    }
  }
  return true;
};

/**
 * @param {string} text Possibly multiline text containing spans that cross
 *     line breaks.
 * @return {Array.<string>} An array of individual lines, each of which has
 *     entirely balanced <span> tags.
 */
differ.distributeSpans_ = function(text) {
  var lines = difflib.stringAsLines(text);
  var spanRe = /(<span[^>]*>)|(<\/span>)/;

  var outLines = [];
  var liveSpans = [];
  lines.forEach(function(line) {
    var groups = line.split(spanRe);
    var i = 0;
    var outLine = liveSpans.join('');
    while (i < groups.length) {
      var g = groups[i];
      if (g === undefined) {
        // close span
        outLine += groups[i + 1];
        liveSpans.pop();
        i += 2;
      } else if (g.substr(0, 5) == '<span') {
        // open span
        i += 2;
        outLine += g;
        liveSpans.push(g);
      } else {
        // plain text
        outLine += g;
        i++;
      }
    }
    liveSpans.forEach(function() { outLine += '</span>'; });
    outLines.push(outLine);
  });
  if (liveSpans.length) throw "Unbalanced <span>s in " + text;
  return outLines;
};

/**
 * @param {string} text The lines to highlight.
 * @param {?string} opt_language Language to pass to highlight.js. If not
 *     specified, then the language will be auto-detected.
 * @return {Array.<string>} Lines marked up with syntax <span>s. The <span>
 *     tags will be balanced within each line.
 */
differ.highlightText_ = function(text, opt_language) {
  if (text === null) return [];

  // TODO(danvk): look into suppressing highlighting if .relevance is low.
  var html;
  if (opt_language) {
    html = hljs.highlight(opt_language, text, true).value;
  } else {
    return null;
    // This produces a lot of false positives:
    // html = hljs.highlightAuto(text).value;
    // There is a relevance number but it's hard to threshold. The file
    // extension is probably a good enough heuristic.
  }

  // Some of the <span>s might cross lines, which won't work for our diff
  // structure. We convert them to single-line only <spans> here.
  return differ.distributeSpans_(html);
}

/**
 * Attach event listeners, notably for the "show more" links.
 */
differ.prototype.attachHandlers_ = function(el) {
  // Synchronize horizontal scrolling.
  var $wrapperDivs = $(el).find('.diff-wrapper');
  $wrapperDivs.on('scroll', function(e) {
    var otherDiv = $wrapperDivs.not(this).get(0);
    otherDiv.scrollLeft = this.scrollLeft;
  });

  var this_differ = this;
  $(el).on('click', '.skip a', function(e) {
    e.preventDefault();
    var skipData = $(this).closest('.skip').data();
    var beforeIdx = skipData.beforeStartIndex;
    var afterIdx = skipData.afterStartIndex;
    var jump = skipData.jumpLength;
    var beforeEnd = beforeIdx + jump;
    var afterEnd = afterIdx + jump;
    var change = "equal";
    var newRows = [];
    for (var i = 0; i < jump; i++) {
      var data = this_differ.buildRow_(beforeIdx, beforeEnd, afterIdx, afterEnd, change);
      beforeIdx = data.newBeforeIdx;
      afterIdx = data.newAfterIdx;
      newRows.push(data.row);
    }

    // Replace the "skip" rows with real code.
    var $lefts = $(this).closest('.diff').find('.diff-left').find('[line-no=' + (1+skipData.beforeStartIndex) + ']');
    var $rights = $(this).closest('.diff').find('.diff-right').find('[line-no=' + (1+skipData.afterStartIndex) + ']');

    if ($lefts.length == 2 && $rights.length == 2) {
      var els = [$lefts.get(0), $lefts.get(1), $rights.get(0), $rights.get(1)];
      for (var rowIdx = newRows.length - 1; rowIdx >= 0; rowIdx--) {
        var row = newRows[rowIdx];
        for (var i = 0; i < row.length; i++) {
          $(els[i]).after(row[i]);
        }
      }
      els.forEach(function(el) { $(el).remove(); });
    }
  });
};

differ.prototype.buildRow_ = function(beforeIdx, beforeEnd, afterIdx, afterEnd, change) {
  // TODO(danvk): move this logic into addCells() or get rid of it.
  var beforeLines = this.params.language ? this.beforeLinesHighlighted : this.beforeLines;
  var afterLines = this.params.language ? this.afterLinesHighlighted : this.afterLines;

  var els = [];
  beforeIdx = addCells(els, beforeIdx, beforeEnd, this.params.language, beforeLines, 'before ' + change, beforeIdx + 1);
  afterIdx = addCells(els, afterIdx, afterEnd, this.params.language, afterLines, 'after ' + change, afterIdx + 1);

  if (change == 'replace' && !this.suppressCharDiffs_) {
    differ.addCharacterDiffs_(els[1], els[3], this.params.language);
  }

  return {
    row: els,
    newBeforeIdx: beforeIdx,
    newAfterIdx: afterIdx
  };
};

differ.prototype.buildView_ = function() {
  var $leftLineDiv = $('<div class="diff-line-no diff-left diff-left-line-no">');
  var $leftContent = $('<div class="diff-content diff-left-content">');
  var $rightLineDiv = $('<div class="diff-line-no diff-right diff-right-line-no">');
  var $rightContent = $('<div class="diff-content diff-right-content">');

  var contextSize = this.params.contextSize;
  var rows = [];

  for (var opcodeIdx = 0; opcodeIdx < this.opcodes.length; opcodeIdx++) {
    var opcode = this.opcodes[opcodeIdx];
    var change = opcode[0];  // "equal", "replace", "delete", "insert"
    var beforeIdx = opcode[1];
    var beforeEnd = opcode[2];
    var afterIdx = opcode[3];
    var afterEnd = opcode[4];
    var rowCount = Math.max(beforeEnd - beforeIdx, afterEnd - afterIdx);
    var topRows = [];
    var botRows = [];

    for (var i = 0; i < rowCount; i++) {
      // Jump
      if (contextSize && this.opcodes.length > 1 && change == 'equal' &&
          ((opcodeIdx > 0 && i == contextSize) ||
           (opcodeIdx == 0 && i == 0))) {
        var jump = rowCount - ((opcodeIdx == 0 ? 1 : 2) * contextSize);
        var isEnd = (opcodeIdx + 1 == this.opcodes.length);
        if (isEnd) {
          jump += (contextSize - 1);
        }
        if (jump > 1) {
          var els = [];
          topRows.push(els);

          var $skipEl = $('<div class="skip code"><a href="#">Show ' + jump + ' lines</a></div>');
          $skipEl.data({
            'beforeStartIndex': beforeIdx,
            'afterStartIndex': afterIdx,
            'jumpLength': jump,
          }).attr('line-no', 1 + afterIdx);
          
          els.push($('<div class=line-no>&hellip;</div>').attr('line-no', 1+beforeIdx).get(0));
          els.push($('<div class="skip code">...</div>').attr('line-no', 1+beforeIdx).get(0));
          els.push($('<div class=line-no>&hellip;</div>').attr('line-no', 1+afterIdx).get(0));
          els.push($skipEl.get(0));

          beforeIdx += jump;
          afterIdx += jump;
          i += jump - 1;
          
          // skip last lines if they're all equal
          if (isEnd) {
            break;
          } else {
            continue;
          }
        }
      }

      var data = this.buildRow_(beforeIdx, beforeEnd, afterIdx, afterEnd, change);
      beforeIdx = data.newBeforeIdx;
      afterIdx = data.newAfterIdx;
      topRows.push(data.row);
    }

    for (var i = 0; i < topRows.length; i++) rows.push(topRows[i]);
    for (var i = 0; i < botRows.length; i++) rows.push(botRows[i]);
  }

  var $container = $('<div class="diff">');

  $leftLineDiv.append($('<div class="line-no-header">&nbsp;</div>'));
  $rightLineDiv.append($('<div class="line-no-header">&nbsp;</div>'));
  $leftContent.append($('<div class="diff-header">').text(this.params.beforeName));
  $rightContent.append($('<div class="diff-header">').text(this.params.afterName));

  $container.append(
      $('<div class="diff-column diff-left">').append(
        $leftLineDiv,
        $('<div class="diff-remainder">').append(
          $('<div class="diff-wrapper diff-left diff-column-width">').append($leftContent))
      ),
      $('<div class="diff-column diff-right">').append(
        $rightLineDiv,
        $('<div class="diff-remainder">').append(
          $('<div class="diff-wrapper diff-right diff-column-width">').append($rightContent))
      )
      );

  // TODO(danvk): append each element of rows to the appropriate div here.
  rows.forEach(function(row) {
    if (row.length != 4) throw "Invalid row: " + row;

    $leftLineDiv.append(row[0]);
    $leftContent.append(row[1]);
    $rightLineDiv.append(row[2]);
    $rightContent.append(row[3]);
  });

  this.attachHandlers_($container);

  return $container.get(0);
};

function addCells(row, tidx, tend, isHtml, textLines, change, line_no) {
  if (tidx < tend) {
    var txt = textLines[tidx].replace(/\t/g, "\u00a0\u00a0\u00a0\u00a0");
    row.push($('<div class=line-no>')
                  .text(tidx + 1)
                  .attr('line-no', line_no)
                  .get(0));
    var $code = $('<div>').addClass(change + ' code').attr('line-no', line_no);
    if (isHtml) {
      $code.html(txt);
    } else {
      $code.text(txt);
    }
    row.push($code.get(0));
    return tidx + 1;
  } else {
    row.push($('<div class=line-no>').attr('line-no', line_no).get(0));
    row.push($('<div class="empty code">').attr('line-no', line_no).get(0));
    return tidx;
  }
}

differ.htmlTextMapper = function(text, html) {
  this.text_ = text;
  this.html_ = html;
};

// Get the substring of HTML corresponding to text.substr(start, len).
// Leading markup is included with index 0, trailing with the last char.
differ.htmlTextMapper.prototype.getHtmlSubstring = function(start, limit) {
  var count = limit - start;
  return html_substr(this.html_, start, count);
};

// Returns the HTML corresponding to text in positions [start, start+count).
// This includes any HTML in that character range, or enclosing it.
// cobbled together from:
// http://stackoverflow.com/questions/6003271/substring-text-with-html-tags-in-javascript?rq=1
// http://stackoverflow.com/questions/16856928/substring-text-with-javascript-including-html-tags
function html_substr(html, start, count) {
  var div = document.createElement('div');
  div.innerHTML = html;
  var consumed = 0;
  
  walk(div, track);
  
  function track(el) {
    if (count > 0) {
      var len = el.data.length;
      if (start <= len) {
        el.data = el.substringData(start, len);
        start = 0;
      } else {
        start -= len;
        el.data = '';
      }
      len = el.data.length;
      count -= len;
      consumed += len;
      if (count <= 0) {
        el.data = el.substringData(0, el.data.length + count);
      }
    } else {
      el.data = '';
    }
  }
  
  function walk(el, fn) {
    var node = el.firstChild, oldNode;
    var elsToRemove = [];
    do {
      if (node.nodeType === 3) {
        fn(node);
      } else if (node.nodeType === 1 && node.childNodes && node.childNodes[0]) {
        walk( node, fn );
      }
      if (consumed == 0 && node.nodeType == 1) {
        elsToRemove.push(node);
      }
    } while ((node = node.nextSibling) && (count > 0));

    // remove remaining nodes
    while (node){
      oldNode = node;
      node = node.nextSibling;
      el.removeChild(oldNode);
    }

    for (var i = 0; i < elsToRemove.length; i++) {
      var el = elsToRemove[i];
      if (el && el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }
  }

  return div.innerHTML;
}


differ.addCharacterDiffs_ = function(beforeCell, afterCell) {
  var beforeText = $(beforeCell).text(),
      afterText = $(afterCell).text(),
      beforeHtml = $(beforeCell).html(),
      afterHtml = $(afterCell).html();
  var sm = new difflib.SequenceMatcher(beforeText.split(''), afterText.split(''));
  var opcodes = sm.get_opcodes();
  var minEqualFrac = 0.5;  // suppress character-by-character diffs if there's less than this much overlap.
  var equalCount = 0, charCount = 0;
  opcodes.forEach(function(opcode) {
    var change = opcode[0];
    var beforeLen = opcode[2] - opcode[1];
    var afterLen = opcode[4] - opcode[3];
    var count = beforeLen + afterLen;
    if (change == 'equal') equalCount += count;
    charCount += count;
  });
  if (equalCount < minEqualFrac * charCount) return;

  var m = differ.htmlTextMapper.prototype.getHtmlSubstring;
  var beforeMapper = new differ.htmlTextMapper(beforeText, beforeHtml);
  var afterMapper = new differ.htmlTextMapper(afterText, afterHtml);

  var beforeOut = [], afterOut = [];  // (span class, start, end) triples
  opcodes.forEach(function(opcode) {
    var change = opcode[0];
    var beforeIdx = opcode[1];
    var beforeEnd = opcode[2];
    var afterIdx = opcode[3];
    var afterEnd = opcode[4];
    if (change == 'equal') {
      beforeOut.push([null, beforeIdx, beforeEnd]);
      afterOut.push([null, afterIdx, afterEnd]);
    } else if (change == 'delete') {
      beforeOut.push(['delete', beforeIdx, beforeEnd]);
    } else if (change == 'insert') {
      afterOut.push(['insert', afterIdx, afterEnd]);
    } else if (change == 'replace') {
      beforeOut.push(['delete', beforeIdx, beforeEnd]);
      afterOut.push(['insert', afterIdx, afterEnd]);
    } else {
      throw "Invalid opcode: " + opcode[0];
    }
  });
  beforeOut = differ.simplifyCodes_(beforeOut);
  afterOut = differ.simplifyCodes_(afterOut);

  $(beforeCell).empty().html(differ.codesToHtml_(beforeMapper, beforeOut));
  $(afterCell).empty().html(differ.codesToHtml_(afterMapper, afterOut));
};

// codes are (span class, start, end) triples.
// This merges consecutive runs with the same class, which simplifies the HTML.
differ.simplifyCodes_ = function(codes) {
  var newCodes = [];
  for (var i = 0; i < codes.length; i++) {
    var code = codes[i];
    if (i == 0) {
      newCodes.push(code);
      continue;
    }

    var lastIndex = newCodes.length - 1;
    var lastCodeClass = newCodes[lastIndex][0];
    if (lastCodeClass == code[0]) {
      newCodes[lastIndex][2] = code[2];  // extend last run.
    } else {
      newCodes.push(code);
    }
  }

  return newCodes;
};

// codes are (span class, start, end) triples.
// This wraps html[start..end] in appropriate <span>..</span>s.
differ.codesToHtml_ = function(mapper, codes) {
  var html = '';
  for (var i = 0; i < codes.length; i++) {
    var code = codes[i],
        type = code[0],
        start = code[1],
        limit = code[2];
    var thisHtml = mapper.getHtmlSubstring(start, limit);
    if (type == null) {
      html += thisHtml;
    } else {
      html += '<span class="char-' + type + '">' + thisHtml + '</span>';
    }
  }
  return html;
}


differ.buildView = function(beforeText, afterText, userParams) {
  var d = new differ(beforeText, afterText, userParams);
  return d.buildView_();
};

return differ;

})();
