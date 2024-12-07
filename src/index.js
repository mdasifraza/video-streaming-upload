const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: '.env' });

// Initialize the Express app
const app = express();
const PORT = process.env.PORT;

// MongoDB connection
const mongoURI = process.env.DB_URI;
const client = new MongoClient(mongoURI);
let bucket;

// Connect to MongoDB and initialize GridFSBucket
client.connect().then(() => {
  const database = client.db();
  bucket = new GridFSBucket(database, { bucketName: 'videos' });
  console.log('Connected to MongoDB');
});

// Multer setup for in-memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Upload endpoint
app.post('/upload', upload.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send('No file uploaded.');
    }

    // Open a GridFS upload stream
    const uploadStream = bucket.openUploadStream(req.file.originalname, {
      contentType: req.file.mimetype,
    });

    // Pipe the file buffer to the upload stream
    uploadStream.end(req.file.buffer);

    uploadStream.on('finish', () => {
      res.status(201).send({ message: 'Video uploaded successfully.', fileId: uploadStream.id });
    });

    uploadStream.on('error', (err) => {
      console.error(err);
      res.status(500).send('Error uploading video.');
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error.');
  }
});

// Stream video endpoint
app.get('/stream/:id', async (req, res) => {
  try {
    const fileId = ObjectId.createFromHexString(req.params.id);

    // Find the file metadata in the database
    const file = await bucket.find({ _id: fileId }).toArray();
    if (!file.length) {
      return res.status(404).send('Video not found.');
    }

    const range = req.headers.range;
    if (!range) {
      return res.status(416).send('Requires Range header.');
    }

    const videoFile = file[0];
    const videoSize = videoFile.length;
    const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB chunks
    const start = Number(range.replace(/\D/g, ''));
    const end = Math.min(start + CHUNK_SIZE, videoSize - 1);
    const contentLength = end - start + 1;

    const headers = {
      'Content-Range': `bytes ${start}-${end}/${videoSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': contentLength,
      'Content-Type': videoFile.contentType,
    };

    res.writeHead(206, headers);

    // Create a read stream for the requested video chunk
    const downloadStream = bucket.openDownloadStream(fileId, { start, end: end + 1 });
    downloadStream.pipe(res);

    downloadStream.on('error', (err) => {
      console.error(err);
      res.status(500).send('Error streaming video.');
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error.');
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});