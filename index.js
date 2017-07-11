var zipfile = require('zipfile');
var path = require('path');
var os = require('os');
var fs = require('fs');
var mkdirp = require('mkdirp');
var crypto = require('crypto');
var queue = require('queue-async');

// File exts to look for according to http://en.wikipedia.org/wiki/Shapefile
var exts = [
  '.shp',
  '.shx',
  '.dbf',
  '.prj',
  '.sbn',
  '.sbx',
  '.fbn',
  '.fbx',
  '.ain',
  '.aih',
  '.ixs',
  '.mxs',
  '.atx',
  '.xml',
  '.cpg',
  '.qix',
  '.index'
];

module.exports = function(filepath, callback, options) {
  if(!options) options = {};
  filepath = path.resolve(filepath);


  var tmpdir = options.tmpdir ? options.tmpdir : os.tmpdir();
  var extract = options.extract !== undefined ? options.extract : true;

  fs.exists(filepath, function(exists) {
    if (!exists) return callback(new Error('No such file: ' + filepath));
    var zf;
    try { zf = new zipfile.ZipFile(filepath); }
    catch (err) { return callback(invalid('Could not open your zip')); }

    try {
      if(extract){
        extractFiles(zf, getShapeFiles(zf, options), callback, tmpdir);
      }else{
        //just process the shapefile to validate and get the list
        callback(getShapeFiles(zf, options));
      }

    } catch(err) {
      return callback(err);
    }
  });
};

function invalid(msg) {
  var err = new Error(msg);
  err.code = 'EINVALID';
  return err;
}

function multiple(msg, shapefiles) {
  var err = new Error(msg);
  err.code = 'MULTIPLESHP';
  err.shapefiles = shapefiles;
  return err;
}

function getShapeFiles(zf, options) {
  // Must contain some files
  if (zf.names.length === 0) {
    throw invalid('ZIP file is empty');
  }

  // Find .shp files
  var shapefileName = zf.names.filter(function(filename) {
    return path.extname(filename).toLowerCase() === '.shp' &&
      !/__MACOSX/.test(filename);
  });

  var selectedShapeFileName = null;
  //if user specifies which shapefile to extract
  if (shapefileName.length > 1 && options.shapefileName) {
    shapefileName.forEach(function(name){
      if(name == options.shapefileName){
        selectedShapeFileName = name;
      }
    });
    if(!selectedShapeFileName){
       throw invalid('requested shapefile not found: '+  options.shapefileName);
    }
  } else if (shapefileName.length > 1) {
    // Must contain exactly one .shp file
    throw multiple('found multiple shapefiles', shapefileName);
  } else if (shapefileName.length === 0) {
    throw invalid('ZIP file did not contain a shp file');
  }else {
    selectedShapeFileName = shapefileName[0];
  }


  // Find the shapefile's basename and dir inside the zip
  var shapefileBase = path.basename(selectedShapeFileName, path.extname(selectedShapeFileName));
  var shapefilePath = path.dirname(selectedShapeFileName);

  // Find all the shapefile-files
  var shapeFiles = zf.names.reduce(function(memo, filename) {
    var ext = path.extname(filename);
    var extLower = ext.toLowerCase();
    if (ext === '.xml') ext = '.shp.xml';
    var base = path.basename(filename, ext);
    var dir = path.dirname(filename);
    if (base === shapefileBase &&
      dir === shapefilePath &&
      exts.indexOf(extLower) > -1) {
      memo[extLower.slice(1)] = filename;
    }
    return memo;
  }, {});

  var missingFiles = ['shp', 'dbf', 'shx'].filter(function(requiredExtension) {
    return !shapeFiles[requiredExtension];
  });

  if (missingFiles.length) {
    var s = missingFiles.length > 1 ? 's' : '';
    throw invalid('ZIP file was missing a required part' + s + ': ' + missingFiles.join(', '));
  }

  // Passed!
  return shapeFiles;
}

function sanitizeName(filename) {
  return path.basename(filename)
    .replace(/ /g, '_')
    .replace(/\\/g, '_')
    .toLowerCase();
}

function extractFiles(zf, files, callback, tmpdir) {
  var dir = path.join(
    tmpdir,
    path.basename(files.shp, '.shp'),
    crypto.randomBytes(12).toString('hex')
  );

  function writeFile(filename, cb) {
    var cleanName = sanitizeName(filename);
    var outfile = path.join(dir, cleanName);
    zf.copyFile(filename, outfile, function(err) {
      if (err) return cb(invalid('Error copying zipfile while unpacking!'));
      cb();
    });
  }

  mkdirp(dir, function(err) {
    if (err) return callback(err);

    var q = queue();

    Object.keys(files).forEach(function(ext) {
      q.defer(writeFile, files[ext]);
    });

    q.await(function(err) {
      if (err) return callback(err);
      callback(path.join(dir, sanitizeName(files.shp)));
    });
  });
}
