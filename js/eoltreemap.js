EOLTreeMap.config = {
	levelsToShow: 1, //number of levels to show at once
	titleHeight: 22, //taxon name container height
	offset:2, //controls the thickness of container borders
	minFontSize:10, //taxon names will shrink to fit until they reach this size
	
	Color: {
		allow: false,
		minValue: 0,
		maxValue: 1,
		minColorValue: [0, 0, 0],
		maxColorValue: [192, 192, 192]
	}
};

function EOLTreeMap(container) {

	this.rootId = container.id;
	jQuery(container).addClass("treemap-container");
	this.api = new EolApi();
	this.controller.api = this.api;
	
	/** 
	 * returns new custom taxon objects instead of hierarchy_entries objects
	 */
	this.api.fetchNode = function (taxonID, onSuccess) {
		this.hierarchy_entries(taxonID, function (json) {
			var taxon = new Taxon(json);
			onSuccess(taxon);
		});
	};

	
	
	this.nodeSelectHandlers = [];
	this.viewChangeHandlers = [];
	this.selectionFrozen = false;
	
	this.tree = EOLTreeMap.stump(); //start with a stump tree, so view() has something to graft to.  
	
	/* Using controller.onBeforeCompute to set this.shownTree before plot is 
	 * called, where it's needed for leaf calc.  But can't give controller 
	 * a field referring back to this EOLTreeMap because the reference cycle appears 
	 * to break Nicolas' JIT class system (it causes an infinite recursion in 
	 * $unlink())
	 */
	var that = this;
	this.controller.setShownTree = function(json) {
		this.shownTree = json;
		that.shownTree = json;
	}
	
	jQuery(".selectable").live("mouseenter", function() {
		that.select(this.id);
	});
	
	jQuery(".selectable").live("mouseleave", function() {
		that.select(null);
	});
	
	jQuery(document).keydown(function (eventObject) {
		if (eventObject.keyCode === 70) {
			that.selectionFrozen = true;
			jQuery("img.freeze-indicator").show();
		}
	});
	
	jQuery(document).keyup(function (eventObject) {
		if (eventObject.keyCode === 70) {
			that.selectionFrozen = false;
			jQuery("img.freeze-indicator").hide();
			
			//update the selection to the currently hovered node
			var hoverId = jQuery(".selectable:hover").last().attr("id");
			if (hoverId) {
				that.select(hoverId);
			}
		}
	});
	
	this.addNodeSelectHandler(function (node) {
		//update freeze indicator position
		var newParent;
		if (node != null) {
			newParent = jQuery("#" + node.id);
		} else {
			newParent = jQuery(".treemap-container");
		}
		jQuery("img.freeze-indicator").detach().appendTo(newParent);
	});
}

EOLTreeMap.prototype = new TM.Squarified(EOLTreeMap.config);
EOLTreeMap.prototype.constructor = EOLTreeMap;

/* 
 * Calls callback(node) when a node is 'selected' (for display, not navigation). 
 * Calls callback(null) when no node is selected.
 */
EOLTreeMap.prototype.addNodeSelectHandler = function(handler) {
	this.nodeSelectHandlers.push(handler);
};

EOLTreeMap.prototype.addViewChangeHandler = function(handler){
	this.viewChangeHandlers.push(handler);
};

EOLTreeMap.prototype.select = function(id) {
	if (!this.selectionFrozen) {
		this.selectedNode = TreeUtil.getSubtree(this.tree, id);
		var that = this;
		
		if (this.selectedNode && !this.selectedNode.apiContentFetched) {
			//current node and breadcrumb ancestors may not have been fetched yet
			this.api.decorateNode(this.selectedNode, function () {
				that.selectedNode.apiContentFetched = true;
				
				//if user is still hovering that node, go ahead and select it again now that the api content is available
				var hoverId = jQuery(".selectable:hover").last().attr("id");
				if (id === hoverId) {
					that.select(id);
				}
			});
		}
		
		jQuery.each(this.nodeSelectHandlers, function(index, handler) {
			handler(that.selectedNode);
		});
	}
};

/*
 * Override of TM.view.  Fetches nodes (and their lineage) instead of just assuming they're 
 * already in the tree. For example, when the user jumps to a different classification
 * or loads a bookmarked URL.
 * Also, view(null) will just refresh the current view (recalculates layout for browser resize)
 */
EOLTreeMap.prototype.view = function(id) {
	if (id === null) {
		this.loadTree(this.shownTree.id); //recalculate and refresh
	}
	
	var that = this;
	var node = TreeUtil.getSubtree(this.tree, id);

	post = jQuery.extend({}, this.controller);
	post.onComplete = function() {
		that.loadTree(id);
		jQuery("<img class='freeze-indicator' src='images/Snowflake-black.png'>").appendTo("#" + that.rootId).hide();
		jQuery.each(that.viewChangeHandlers, function(index, handler) {
			handler(that.shownTree);
		});
	};

	if (!node) {
		this.api.fetchNode(id, function (json) {
			that.graft(that.tree, json, function (newNode) {
				TreeUtil.loadSubtrees(newNode, post, that.controller.levelsToShow);
			});
		});
	} else {
		TreeUtil.loadSubtrees(node, post, this.controller.levelsToShow);
	}
	
	
};

/* 
 * Adds an EOL hierarchy entry to a subtree, fetching its ancestors as necessary 
 * json: the hierarchy entry
 * subtree: a subtree containing this entry
 * callback: callback(node_in_tree_for_json)
 */
EOLTreeMap.prototype.graft = function (subtree, json, callback) {
	var that = this;
	if(!subtree.children || subtree.children.length === 0) {
		//the ancestor's full node hasn't been fetched yet.  Get it, then try again.
		this.api.fetchNode(subtree.taxonID, function (fullNode) {
			subtree.merge(fullNode);
			that.graft(subtree, json, callback);
		});
	} else {
		var childMatch = jQuery.grep(subtree.children, function (child) {return child.taxonID == json.taxonID })[0];
		if (childMatch) {
			//found the location of the hierarchy entry
			childMatch.merge(json);
			callback(childMatch);
		} else {
			//try the next ancestor on json's array
			var nextAncestorID;
			if (subtree === this.tree) {
				//we're at the root, so the next ancestor is the classification
				nextAncestorID = jQuery.grep(this.tree.children, function (classification) { return classification.name == json.nameAccordingTo })[0].id;
			} else if (subtree.name == json.nameAccordingTo) {
				//we're at the classification, so the next ancestor is the hierarchy_entry root (e.g. the kingdom)
				nextAncestorID = json.ancestors[0].taxonID;
			} else {
				nextAncestorID = jQuery.grep(json.ancestors, function (ancestor) {return ancestor.parentNameUsageID == subtree.taxonID })[0].taxonID;
			}
			
			var nextAncestor = jQuery.grep(subtree.children, function (child) {return child.id == nextAncestorID })[0];
			this.graft(nextAncestor, json, callback);
		}
	}
};

EOLTreeMap.stump = function () {
	
	var setChildren = function(taxon) {
		jQuery.each(taxon.children, function(index, child) {
			child.parent = taxon;
		});
	};
	
	/* TODO: put the rest of the roots in (for all classifications).*/
	var col = new Taxon(null, "COL", "Species 2000 & ITIS Catalogue of Life: Annual Checklist 2009");
	col.image = {mediaURL:"http://www.catalogueoflife.org/annual-checklist/2009/images/2009_checklist_cd_front_cover.jpg"};
	col.text = {description:"<p><b>CoL</b> <a href='http://www.catalogueoflife.org/'>http://www.catalogueoflife.org/</a><br>The Catalogue of Life Partnership (CoLP) is an informal partnership dedicated to creating an index of the world�s organisms, called the Catalogue of Life (CoL). The CoL provides different forms of access to an integrated, quality, maintained, comprehensive consensus species checklist and taxonomic hierarchy, presently covering more than one million species, and intended to cover all know species in the near future. The Annual Checklist EOL uses contains substantial contributions of taxonomic expertise from more than fifty organizations around the world, integrated into a single work by the ongoing work of the CoLP partners. EOL currently uses the CoL Annual Checklist as its taxonomic backbone.</p>"};
	
	col.children = [
	    new Taxon({taxonID:"24974884", taxonConceptID:"1", scientificName:"Animalia"}),
	    new Taxon({taxonID:"26322083", taxonConceptID:"7920", scientificName:"Archaea"}),
	    new Taxon({taxonID:"27919817", taxonConceptID:"288", scientificName:"Bacteria"}),
	    new Taxon({taxonID:"26310295", taxonConceptID:"3352", scientificName:"Chromista"}),
	    new Taxon({taxonID:"26250396", taxonConceptID:"5559", scientificName:"Fungi"}),
	    new Taxon({taxonID:"26017607", taxonConceptID:"281", scientificName:"Plantae"}),
	    new Taxon({taxonID:"26301920", taxonConceptID:"4651", scientificName:"Protozoa"}),
	    new Taxon({taxonID:"26319587", taxonConceptID:"5006", scientificName:"Viruses"})
	];
	setChildren(col);
	
	var ncbi = new Taxon(null, "NCBI", "NCBI Taxonomy");
	ncbi.image = {mediaURL:"http://www.ncbi.nlm.nih.gov/projects/GeneTests/static/img/white_ncbi.png"};
	ncbi.text = {description:"<p><b>NCBI</b> <a href='http://www.ncbi.nlm.nih.gov/'>http://www.ncbi.nlm.nih.gov</a><br>As a U.S. national resource for molecular biology information, NCBI's mission is to develop new information technologies to aid in the understanding of fundamental molecular and genetic processes that control health and disease. The NCBI taxonomy database contains the names of all organisms that are represented in the genetic databases with at least one nucleotide or protein sequence.</p>"};
	
	ncbi.children = [
	    new Taxon({taxonID:"28670753", taxonConceptID:"11660866", scientificName:"cellular organisms"}),
	    new Taxon({taxonID:"28665715", taxonConceptID:"11655828", scientificName:"other sequences"}),
	    new Taxon({taxonID:"28665429", taxonConceptID:"11655542", scientificName:"unclassified sequences"}),
	    new Taxon({taxonID:"28665341", taxonConceptID:"9157757", scientificName:"Viroids"}), 
	    new Taxon({taxonID:"28612987", taxonConceptID:"5006", scientificName:"Viruses"})
	];
	setChildren(ncbi);
	
	var iucn = new Taxon(null, "IUCN", "IUCN Red List (Species Assessed for Global Conservation)");
	iucn.image = {mediaURL:"images/iucn_high_res.jpg"};
	iucn.text = {description:"<p><b>IUCN</b> <a href='http://www.iucn.org//'>http://www.iucn.org/</a><br>International Union for Conservation of Nature (IUCN) helps the world find pragmatic solutions to our most pressing environment and development challenges. IUCN supports scientific research; manages field projects all over the world; and brings governments, non-government organizations, United Nations agencies, companies and local communities together to develop and implement policy, laws and best practice. EOL partnered with the IUCN to indicate status of each species according to the Red List of Threatened Species.</p>"};
	
	iucn.children = [
	    new Taxon({taxonID:"24913771", taxonConceptID:"1", scientificName:"Animalia"}), 
        new Taxon({taxonID:"24925347", taxonConceptID:"5559", scientificName:"Fungi"}), 
        new Taxon({taxonID:"24913778", taxonConceptID:"281", scientificName:"Plantae"}), 
        new Taxon({taxonID:"24920520", taxonConceptID:"3121393", scientificName:"Protista"})
	];
	setChildren(iucn);
	
	var fishbase = new Taxon(null, "FishBase", "FishBase (Fish Species)");
	fishbase.image = {mediaURL:"http://bio.slu.edu/mayden/cypriniformes/images/fishbase_logo.jpg"};
	fishbase.text = {description:"<p><b>FishBase</b> <a href='http://www.fishbase.org/'>http://www.fishbase.org/</a><br>FishBase is a global information system with all you ever wanted to know about fishes. FishBase is a relational database with information to cater to different professionals such as research scientists, fisheries managers, zoologists and many more. The FishBase Website contains data on practically every fish species known to science. The project was developed at the WorldFish Center in collaboration with the Food and Agriculture Organization of the United Nations and many other partners, and with support from the European Commission. FishBase is serving information on more than 30,000 fish species through EOL.</p>"};
	
	fishbase.children = [
	    new Taxon({taxonID:"24876515", taxonConceptID:"1", scientificName:""})
	];
	setChildren(fishbase);
	
	var tree = new Taxon(null, "HOME", "Classifications");
	tree.children = [col, iucn, ncbi, fishbase];
	setChildren(tree);

	//make sure we don't try to do EOL API calls for these dummy nodes
	tree.apiContentFetched = true;
	jQuery.each(tree.children, function(index, child) {child.apiContentFetched = true;});
	
	return tree;
}

EOLTreeMap.resizeImage = function (image, container) {
	container = jQuery(container);
	var containerAR = container.innerWidth() / container.innerHeight();
	
	var imageAR = image.naturalWidth / image.naturalHeight;
	
	if (imageAR >= containerAR) {
		//image aspect ratio is wider than container: fit height, center width overlap
		var calcWidth = (container.innerHeight() / image.naturalHeight) * image.naturalWidth;
		image.height = container.innerHeight();
		image.width = calcWidth; //force IE to maintain aspect ratio
		jQuery(image).css("marginLeft",  (container.innerWidth() - calcWidth) / 2);
	}
	else {
		//image aspect ratio is taller than container: fit width, center height overlap
		var calcHeight = (container.innerWidth() / image.naturalWidth) * image.naturalHeight;
		image.width = container.innerWidth();
		image.height = calcHeight; //force IE to maintain aspect ratio
		jQuery(image).css("marginTop",  (container.innerHeight() - calcHeight) / 2);
	}
};

EOLTreeMap.help = "<div class='help'><h2>Instructions</h2><div><ul><li>Hover the mouse over a taxon image to see details about that taxon.  To freeze the details panel (so you can click links, select text, etc.), hold down the F key.</li>  <li>Left-click the image to view its subtaxa.</li>  <li>Left-click the underlined taxon name to go to the EOL page for that taxon.</li> <li>Left click the (non-underlined) taxon names in the 'breadcrumb trail' at the top to view supertaxa of this taxon</li> <li>Use your browser's back and next buttons, as you usually would, to see the previous or next page in your history, respectively.</li></div><p>Learn more about the project, download the source code, or leave feedback at the <a href='http://github.com/kurie/EOL-tree-viewer'>GitHub repository</a>. </div>";


/* Overrides TM.createBox to render a leaf with title and image */
EOLTreeMap.prototype.createBox = function (json, coord, html) {
	var box;
	if (this.leaf(json)) {
		if (this.config.Color.allow) {
			box = this.leafBox(json, coord);
		} else {
			box = this.headBox(json, coord) + this.bodyBox("", coord);
		}
	} else {
		if (json.id === this.shownTree.id) {
			box = this.breadcrumbBox(json, coord) + this.bodyBox(html, coord);
		} else {
			box = this.headBox(json, coord) + this.bodyBox(html, coord);
		}
	}

	return this.contentBox(json, coord, box);
};

EOLTreeMap.prototype.contentBox = function(json, coord, html) {
    var c = {};
    for(var i in coord) c[i] = coord[i] + "px";
    return "<div class=\"content selectable\" style=\"" + this.toStyle(c) 
       + "\" id=\"" + json.id + "\">" + html + "</div>";
};

EOLTreeMap.prototype.breadcrumbBox = function(json, coord) {
    var config = this.config, offst = config.offset;
    var c = {
      'height': config.titleHeight + "px",
      'width': (coord.width - offst) + "px",
      'left':  offst / 2 + "px"
    };
    
	//make the root node and classification the first breadcrumbs
	var breadcrumbs = "<a class='breadcrumb ancestor' href='#HOME' id='HOME'>Home</a>";

    if (json.nameAccordingTo) {
    	var shortClassificationName = jQuery.grep(this.tree.children, function (classification){return classification.name == json.nameAccordingTo[0]})[0].id;
    	breadcrumbs += " > ";
    	breadcrumbs += "<a class='breadcrumb ancestor selectable' href='#" + shortClassificationName + "' id='" + shortClassificationName + "'>" + shortClassificationName + "</a>";
    }
    
    //add the ancestors
    if (json.ancestors) {
	    jQuery.each(json.ancestors, function (index, ancestor) {
			breadcrumbs += " > ";
	    	breadcrumbs += "<a class='breadcrumb ancestor selectable' href='#" + ancestor.taxonID + "' id='" + ancestor.taxonID + "'>" + ancestor.scientificName + "</a>";
	    });
    }
	breadcrumbs += " > ";
	
	//wrap the ancestors and their brackets > in a span so they can be styled as a group
	breadcrumbs = "<span class='breadcrumb ancestors'>" + breadcrumbs + "</span>";
    
    //add the current node as a link out to EOL
    if (json.taxonConceptID) {
    	breadcrumbs += "<a class='breadcrumb current selectable' target='_blank' href='http://www.eol.org/" + json.taxonConceptID + "' id='" + json.id + "'>" + json.name + "</a>";
    } else if (json.id != "HOME") {
    	breadcrumbs += "<span class='breadcrumb current'>" + json.name + "</span>";
    }
    
    breadcrumbs = "<span class='breadcrumbs'>" + breadcrumbs + "</span>";
    
    return "<div class=\"head\" style=\"" + this.toStyle(c) + "\">" + breadcrumbs + "</div>";
};

EOLTreeMap.prototype.leaf = function (node) {
	return this.controller.leaf(node, this.shownTree);
};

/* Minor edit of processChildrenLayout to sort equal-area nodes alphabetically */
EOLTreeMap.prototype.processChildrenLayout = function (par, ch, coord) {
	//compute children real areas
	var parentArea = coord.width * coord.height;
	var i, totalChArea = 0, chArea = [];
	for (i = 0; i < ch.length; i++) {
		chArea[i] = parseFloat(ch[i].getArea());
		totalChArea += chArea[i];
	}
	for (i = 0; i < chArea.length; i++) {
		ch[i]._area = parentArea * chArea[i] / totalChArea;
	}
	var minimumSideValue = (this.layout.horizontal())? coord.height : coord.width;
	
	//kgu: sorting by area (required for treemap), then name. In case all of the areas are the same, we might as well have alpha order
	ch.sort(function (a, b) {
		var diff = a._area - b._area;
		return diff || a.name.localeCompare(b.name);
	});
	
	var initElem = [ch[0]];
	var tail = ch.slice(1);
	this.squarify(tail, initElem, minimumSideValue, coord);
};

/**
 * overriding setColor to use Taxon.getColor()
 */
EOLTreeMap.prototype.setColor = function(taxon) {
    var c = this.config.Color,
    maxcv = c.maxColorValue,
    mincv = c.minColorValue,
    maxv = c.maxValue,
    minv = c.minValue,
    diff = maxv - minv,
    x = (taxon.getColor() - 0);
	
	//clamp x to range [minv,maxv]
	x = Math.max(x, minv);
	x = Math.min(x, maxv);
	
    //linear interpolation    
    var comp = function(i, x) { 
      return colorValue = Math.round((((maxcv[i] - mincv[i]) / diff) * (x - minv) + mincv[i])); 
    };
    
    return EOLTreeMap.$rgbToHex([ comp(0, x), comp(1, x), comp(2, x) ]);
};

EOLTreeMap.$rgbToHex = function(srcArray, array){
    if (srcArray.length < 3) return null;
    if (srcArray.length == 4 && srcArray[3] == 0 && !array) return 'transparent';
    var hex = [];
    for (var i = 0; i < 3; i++){
        var bit = (srcArray[i] - 0).toString(16);
        hex.push((bit.length == 1) ? '0' + bit : bit);
    }
    return (array) ? hex : '#' + hex.join('');
};

EOLTreeMap.prototype.optionsForm = function () {
	var form = jQuery("<form name='treemap' onsubmit='return false;'>");
	
	var depth = jQuery("<input type='text' name='depth' size=3>");
	depth.val(this.controller.levelsToShow);
	jQuery("<div>").append("Maximum depth: ").append(depth).appendTo(form);
	
	var showImages = jQuery("<input type='checkbox' name='images'>");
	showImages[0].checked = !this.controller.Color.allow;
	jQuery("<div>").append("Display images: ").append(showImages).appendTo(form);
	
	var colorRange = jQuery("<fieldset>").append("<legend>Color mapping</legend>");
	
	var variableList = jQuery("<select name='variable'>").appendTo(colorRange);
	variableList.append("<option value='total_descendants'>Descendants</option>");
	variableList.append("<option value='total_descendants_with_text'>Descendants w/text</option>");
	variableList.append("<option value='total_descendants_with_images'>Descendants w/images</option>");
	variableList.append("<option value='total_trusted_text'>Text (trusted)</option>");
	variableList.append("<option value='total_unreviewed_text'>Text (unreviewed)</option>");
	variableList.append("<option value='total_trusted_images'>Images (trusted)</option>");
	variableList.append("<option value='total_unreviewed_images'>Images (unreviewed)</option>");
	
	var minValue = jQuery("<input type='text' name='minValue' size=4>");
	var maxValue = jQuery("<input type='text' name='maxValue' size=4>");
	var minColor = jQuery("<input class='color' size=6>");
	var maxColor = jQuery("<input class='color' size=6>");
	minValue.val(this.config.Color.minValue);
	maxValue.val(this.config.Color.maxValue);
	minColor.val(EOLTreeMap.$rgbToHex(this.config.Color.minColorValue));
	maxColor.val(EOLTreeMap.$rgbToHex(this.config.Color.maxColorValue));
	jQuery("<div>").append("Variable value min: ").append(minValue).append("max: ").append(maxValue).appendTo(colorRange);
	jQuery("<div>").append("Color min: ").append(minColor).append("max: ").append(maxColor).appendTo(colorRange);
	
	form.append(colorRange);
	
	/** maps a color value from [0,1] to [0,255] */
	var mapTo255 = function(colorValue) {
		return colorValue * 255;
	};
	
	var that = this;
	var changeHandler = function () {
		//TODO validate
		that.controller.Color.allow = !showImages[0].checked;
		that.controller.levelsToShow = parseInt(depth.val()); 
		
		that.config.Color.minValue = minValue.val();
		that.config.Color.maxValue = maxValue.val();
		that.config.Color.minColorValue = jQuery.map(minColor[0].color.rgb, mapTo255);
		that.config.Color.maxColorValue = jQuery.map(maxColor[0].color.rgb, mapTo255);

		Taxon.prototype.getColor = function(){
			return this[variableList.val()] || 0;
		}

		that.view(null);
		return false;
	};
	
	jQuery("input", form).change(changeHandler);
	jQuery("select", form).change(changeHandler);
	jQuery(form).submit(changeHandler);
	
	return form;
};

EOLTreeMap.prototype.controller.onDestroyElement = function (content, tree, isLeaf, leaf) {
	if (leaf.clearAttributes) { 
		//Remove all element events before destroying it.
		leaf.clearAttributes(); 
	}
};

EOLTreeMap.prototype.controller.onCreateElement = function (content, node, isLeaf, head, body) {  
	if (!node) {
		return;
	}
	
	//if page API content not loaded, get that first and then call this method again
	var that = this;
	if (!node.apiContentFetched) {
		this.api.decorateNode(node, function () {
			node.apiContentFetched = true;
			that.onCreateElement(content, node, isLeaf, head, body);
		});
	}
	
	//if not displaying colors, display images
//	isLeaf = jQuery(body).children().length === 0; //overwriting JIT's isLeaf because I gave leaves a head and body 
	isLeaf = this.leaf(node, this.shownTree);
	if (!this.Color.allow && isLeaf) {
		if (node.apiContentFetched) {
			this.insertBodyContent(node, body);
		} else {
			var placeholder = new Image();
			placeholder.src = "images/ajax-loader.gif";
			jQuery(body).html(placeholder);
		}
	}
};

EOLTreeMap.prototype.controller.onBeforeCompute = function(tree){
	this.setShownTree(tree);
};

EOLTreeMap.prototype.controller.onAfterCompute = function (tree) {
	/*
	 * Adding these elements to the tree in the plotting (createBox, etc...) 
	 * functions or in onCreateElement breaks the tree traversal in 
	 * initializeElements, so I have to add them here
	 */
	
	//Wrap an EOL link around all head divs and a navigation hash link around all of the body divs
	var that = this;
	jQuery("#" + tree.id).find("div .content").each(function (index, element) {
		var node = TreeUtil.getSubtree(tree, this.id);
		
		if (node) {
			var body = jQuery(this).children()[1];
			var head = null;
			
			if (body) {
				head = jQuery(this).children()[0];
			} else {
				body = jQuery(this).children()[0];
				head = jQuery(body).contents()[0];
			}
			
			if (head && node.taxonConceptID) {
				jQuery(head).wrap("<a class='head' target='_blank' href=http://www.eol.org/" + node.taxonConceptID + "></a>");
			}
			
			if (body) {
				jQuery(body).wrap("<a class='body' href=#" + node.id + "></a>");
			}

		}
	});
	
	jQuery(".treemap-container > div.content div.content > a.head > div.head").each(function (index, element) {
		var fontsize = jQuery(this).css("font-size").replace("px","");
		while(this.scrollWidth > this.offsetWidth && fontsize > that.minFontSize) {
			fontsize -= 1;
			jQuery(this).css("font-size", fontsize + "px");
		}
	});
}

EOLTreeMap.prototype.controller.request = function (nodeId, level, onComplete) {
	var controller = this;
	this.api.fetchNode(nodeId, function (json) {
		
		if (level > 0 && json.children && json.children.length > 0) {
			var childrenToCallBack = json.children.length;
			
			jQuery(json.children).each(function (i, child) {
				controller.request(child.taxonID, level - 1, {onComplete: function (id, childJSON){
					child.merge(childJSON);
					childrenToCallBack -= 1;
					if (childrenToCallBack === 0) {
						onComplete.onComplete(nodeId, json);
					}
				}});
			});
		} else {
			onComplete.onComplete(nodeId, json);
		}
	});
};

EOLTreeMap.prototype.controller.insertBodyContent = function (node, container) {
	var that = this;
	
	if (jQuery(container).children().length === 0) {
		var placeholder = new Image();
		placeholder.src = "images/ajax-loader.gif";
		jQuery(container).html(placeholder);
	}
	
	if (!node.apiContentFetched) {
		this.api.decorateNode(node, function () {
			node.apiContentFetched = true;
			that.insertBodyContent(node, container);
		});
		return;
	}
	
	if (node.image) {
		if (node.image.image && node.image.image.src) { //for some reason, IE (only) is resetting these images to have no src...
			this.insertImage(node.image.image, container, function(){});
		} else if (node.image.eolThumbnailURL) { 
			if (!node.image.thumb || !node.image.thumb.src) {
				node.image.thumb = new Image();
				node.image.thumb.src = node.image.eolThumbnailURL;
			}
			this.insertImage(node.image.thumb, container, function(){
				if (node.image.thumb.naturalWidth < jQuery(container).innerWidth()) {
					node.image.image = new Image();
					node.image.image.src = node.image.eolMediaURL;
					that.insertImage(node.image.image, container, function(){});
				}
			});
		} else if (node.image.eolMediaURL) {
			node.image.image = new Image();
			node.image.image.src = node.image.eolMediaURL;
			that.insertImage(node.image.image, container, function(){});
		} else if (node.image.mediaURL) {
			node.image.image = new Image();
			node.image.image.src = node.image.mediaURL;
			that.insertImage(node.image.image, container, function(){});
		}
	} else {
		jQuery(container).html("No image available.<p><a href='http://www.eol.org/content/page/help_build_eol' target='_blank'>Click here to help EOL find one.</a></p>");
	}

};

EOLTreeMap.prototype.controller.insertImage = function (image, container, callback) {
	if (image.complete || image.readyState == "complete") {
		//have to set these for IE.  (They already exist in other browsers...)
		if (!image.naturalHeight || !image.naturalWidth) {
			image.naturalWidth = image.width;
			image.naturalHeight = image.height;
		}
		
		EOLTreeMap.resizeImage(image, container);
		jQuery(container).html(image);
		callback();
	} else {
		jQuery(image).load(function handler(eventObject) {
			if (!image.naturalHeight || !image.naturalWidth) {
				image.naturalWidth = image.width;
				image.naturalHeight = image.height;
			}
			
			EOLTreeMap.resizeImage(image, container);
			jQuery(container).html(image);
			callback();
		});
		
		jQuery(image).error(function handler(eventObject) {
			jQuery(container).html("There was an error loading this image.");
			callback();
		});
	}
};

/* a node is displayed as a leaf if it is at the max displayable depth or if it is actually a leaf in the current tree */
EOLTreeMap.prototype.controller.leaf = function (node, tree) {
	tree = tree || this.shownTree;
	return node.children.length === 0 || node.getDepth() - tree.getDepth() >= this.levelsToShow;
};

function Taxon(hierarchy_entry, id, name) {
	this.data = {};
	this.id = id || hierarchy_entry.taxonID;
	this.name = name || hierarchy_entry.scientificName;
	
	this.merge(hierarchy_entry);

	//make all of the children a Taxon too
	this.children = [];
	var that = this;
	if (hierarchy_entry && hierarchy_entry.children) {
		jQuery.each(hierarchy_entry.children, function(index, child) { 
			var childTaxon = new Taxon(child);
			that.children.push(childTaxon);
			child.parent = that;
		});
	}
	
	
	
	//TODO do I still need to copy children's taxonID over to id?
}

Taxon.prototype.getArea = function() {
	return this.data.$area || Math.sqrt(this.total_descendants) || 1.0;
};

Taxon.prototype.getColor = function(){
	return this.data.$color || this.total_descendants_with_text / (this.total_descendants + 1);
};

Taxon.prototype.getDepth = function() {
	return this.parent && this.parent.getDepth() + 1 || 0;
};

Taxon.prototype.merge = function(other) {
//	jQuery.extend(this, other); //extend appears to be copying prototype functions to the target object, along with data, which is not what I wanted

	for (prop in other){
		if (other.hasOwnProperty(prop) && !(other[prop] instanceof Function)) {
			this[prop] = other[prop];
		}
    }
	
	if (this.children) {
		var that = this;
		jQuery.each(this.children, function(index, child){
			child.parent = that;
		});
	}
};

/*
 * Override of JIT TreeUtil.loadSubtrees.  
 * Loads missing nodes in a subtree to a given depth.  
 * Nodes at depth will be fetched from the api, but their children will be id-only placeholders (will not have children or data)
 */
TreeUtil.loadSubtrees = function (subtree, controller, depth, onComplete) {
	onComplete = onComplete || controller.onComplete;
	if (depth < 0) {
		onComplete();
		return;
	} else if (depth === undefined) {
		depth = controller.levelsToShow;	
	} 
	
	if (!subtree.children || subtree.children.length === 0) {
		
		//this node has not loaded children - do controller.request() to fetch the subtree
		controller.request(subtree.id, depth, {onComplete: function(nodeId, fetchedSubtree){
			subtree.merge(fetchedSubtree);
			onComplete();
		}});

	} else {
		
		//this node has children.  recurse and call onComplete once we've heard back from all of them
		var childrenToCallback = subtree.children.length;
		jQuery(subtree.children).each(function(i, child) {
			TreeUtil.loadSubtrees(child, controller, depth - 1, function () {
				childrenToCallback -= 1;
				if (childrenToCallback === 0) {
					onComplete();
				}
			});
		});
	}
};


