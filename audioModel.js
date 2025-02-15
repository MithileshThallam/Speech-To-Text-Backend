import mongoose from 'mongoose';

const audioSchema = new mongoose.Schema({
  name: String,
  data: Buffer,
  contentType: String
});

const Audio = mongoose.model('Audio', audioSchema);
export default Audio;
