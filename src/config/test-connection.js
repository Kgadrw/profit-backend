// Test MongoDB Connection Script
import 'dotenv/config';
import mongoose from 'mongoose';

// Test connection with different formats
const testConnections = [
  {
    name: 'With encoded password',
    uri: `mongodb+srv://gkalisa8_db_user:${encodeURIComponent('Kigali20')}@cluster0.bbra7ls.mongodb.net/profit-pilot?retryWrites=true&w=majority&appName=Cluster0`
  },
  {
    name: 'Without database name',
    uri: `mongodb+srv://gkalisa8_db_user:${encodeURIComponent('Kigali20')}@cluster0.bbra7ls.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`
  },
  {
    name: 'Raw connection string',
    uri: 'mongodb+srv://gkalisa8_db_user:Kigali20@cluster0.bbra7ls.mongodb.net/profit-pilot?retryWrites=true&w=majority&appName=Cluster0'
  }
];

async function testConnection() {
  for (const config of testConnections) {
    try {
      console.log(`\n🔄 Testing: ${config.name}`);
      await mongoose.connect(config.uri, {
        serverSelectionTimeoutMS: 5000,
      });
      console.log(`✅ SUCCESS with: ${config.name}`);
      console.log(`   Connected to: ${mongoose.connection.host}`);
      console.log(`   Database: ${mongoose.connection.name}`);
      await mongoose.disconnect();
      break;
    } catch (error) {
      console.log(`❌ FAILED with: ${config.name}`);
      console.log(`   Error: ${error.message}`);
      if (mongoose.connection.readyState === 1) {
        await mongoose.disconnect();
      }
    }
  }
}

testConnection()
  .then(() => {
    console.log('\n✅ Connection test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Connection test failed:', error);
    process.exit(1);
  });
