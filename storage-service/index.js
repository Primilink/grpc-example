const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const express = require('express');
const { saveFile, getFile, getAllFiles } = require('./files');

const PROTO_PATH = path.join(__dirname, '../proto/storage.proto');
const GRPC_PORT = 50052;
const HTTP_PORT = 3003;
const CHUNK_SIZE = 64 * 1024; // 64KB chunks

// Load proto file
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const storageProto = grpc.loadPackageDefinition(packageDefinition).storage;

// gRPC service implementation
const storageService = {
  // Client streaming: receive file chunks, return upload response
  UploadFile: (call, callback) => {
    const chunks = [];
    let filename = '';
    let mimeType = '';

    call.on('data', (chunk) => {
      // First chunk contains metadata
      if (!filename && chunk.filename) {
        filename = chunk.filename;
        mimeType = chunk.mimeType || 'application/octet-stream';
        console.log(`[gRPC] UploadFile started: ${filename}`);
      }

      if (chunk.data && chunk.data.length > 0) {
        chunks.push(chunk.data);
      }
    });

    call.on('end', () => {
      const buffer = Buffer.concat(chunks);
      const file = saveFile(filename, mimeType, buffer);

      console.log(`[gRPC] UploadFile complete: ${file.fileId} (${file.size} bytes)`);

      callback(null, {
        fileId: file.fileId,
        filename: file.filename,
        size: file.size,
        success: true,
      });
    });

    call.on('error', (err) => {
      console.error('[gRPC] UploadFile error:', err.message);
      callback(err);
    });
  },

  // Server streaming: receive download request, stream file chunks
  DownloadFile: (call) => {
    const { fileId } = call.request;
    console.log(`[gRPC] DownloadFile requested: ${fileId}`);

    const file = getFile(fileId);

    if (!file) {
      call.emit('error', {
        code: grpc.status.NOT_FOUND,
        message: `File not found: ${fileId}`,
      });
      return;
    }

    // Send first chunk with metadata
    const buffer = file.buffer;
    let offset = 0;

    // Send chunks
    while (offset < buffer.length) {
      const end = Math.min(offset + CHUNK_SIZE, buffer.length);
      const chunkData = buffer.slice(offset, end);

      const chunk = {
        data: chunkData,
        filename: offset === 0 ? file.filename : '',
        mimeType: offset === 0 ? file.mimeType : '',
      };

      call.write(chunk);
      offset = end;
    }

    console.log(`[gRPC] DownloadFile complete: ${fileId} (${buffer.length} bytes)`);
    call.end();
  },
};

// Start gRPC server
function startGrpcServer() {
  const server = new grpc.Server();
  server.addService(storageProto.StorageService.service, storageService);

  server.bindAsync(
    `0.0.0.0:${GRPC_PORT}`,
    grpc.ServerCredentials.createInsecure(),
    (err, port) => {
      if (err) {
        console.error('Failed to start gRPC server:', err);
        process.exit(1);
      }
      console.log(`gRPC server running on port ${port}`);
    }
  );
}

// Start Express server
function startHttpServer() {
  const app = express();

  // GET /files - list all files
  app.get('/files', (req, res) => {
    const files = getAllFiles();
    res.json({ files });
  });

  // GET /files/:id - get file metadata
  app.get('/files/:id', (req, res) => {
    const file = getFile(req.params.id);

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.json({
      fileId: file.fileId,
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size,
      createdAt: file.createdAt,
    });
  });

  // GET /files/:id/download - download file content
  app.get('/files/:id/download', (req, res) => {
    const file = getFile(req.params.id);

    if (!file) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Content-Length', file.size);
    res.send(file.buffer);
  });

  app.listen(HTTP_PORT, () => {
    console.log(`Storage REST API running on http://localhost:${HTTP_PORT}`);
  });
}

// Start both servers
startGrpcServer();
startHttpServer();
