# MongoDB Connection Troubleshooting

## Current Credentials
- **Username**: `gkalisa8_db_user`
- **Password**: `Kigali20`
- **Cluster**: `cluster0.bbra7ls.mongodb.net`
- **Database**: `profit-pilot`

## Common Authentication Errors

### 1. "bad auth : authentication failed"

This error usually means one of these issues:

#### A. IP Address Not Whitelisted
**Solution**: 
1. Go to MongoDB Atlas Dashboard
2. Click on "Network Access" in the left sidebar
3. Click "Add IP Address"
4. Either:
   - Click "Allow Access from Anywhere" (for testing: `0.0.0.0/0`)
   - OR add your specific IP address
5. Save the changes
6. Wait 1-2 minutes for changes to propagate

#### B. Wrong Password
**Solution**:
1. Go to MongoDB Atlas Dashboard
2. Click "Database Access" in the left sidebar
3. Find the user `gkalisa8_db_user`
4. Click "Edit"
5. Verify the password or reset it to `Kigali20`
6. Save changes

#### C. Database User Permissions
**Solution**:
1. Go to "Database Access"
2. Ensure the user has "Atlas Admin" or at least "Read and write to any database" permissions
3. If you created a custom role, make sure it has proper permissions

## Testing Connection

You can test the connection using:
```bash
npm run test:db
```

Or test directly with MongoDB Compass using this connection string:
```
mongodb+srv://gkalisa8_db_user:Kigali20@cluster0.bbra7ls.mongodb.net/profit-pilot?appName=Cluster0
```

## Alternative: Use Environment Variable

You can also set the connection string as an environment variable in `.env`:
```
MONGODB_URI=mongodb+srv://gkalisa8_db_user:Kigali20@cluster0.bbra7ls.mongodb.net/profit-pilot?retryWrites=true&w=majority&appName=Cluster0
```
