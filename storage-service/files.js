const files = new Map();

let fileIdCounter = 1;

function generateFileId() {
  return `file-${fileIdCounter++}`;
}

function saveFile(filename, mimeType, buffer) {
  const fileId = generateFileId();
  const file = {
    fileId,
    filename,
    mimeType,
    buffer,
    size: buffer.length,
    createdAt: new Date().toISOString(),
  };

  files.set(fileId, file);
  return file;
}

function getFile(fileId) {
  return files.get(fileId);
}

function getAllFiles() {
  return Array.from(files.values()).map((f) => ({
    fileId: f.fileId,
    filename: f.filename,
    mimeType: f.mimeType,
    size: f.size,
    createdAt: f.createdAt,
  }));
}

module.exports = {
  saveFile,
  getFile,
  getAllFiles,
};
