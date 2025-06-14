# Gunakan Node.js image (tidak alpine untuk avoid build issues)
FROM node:18

# Set direktori kerja di dalam container
WORKDIR /app

# Copy file package.json dan package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy seluruh source code ke dalam container
COPY . .

# Ekspose port aplikasi
EXPOSE 5020

# Jalankan aplikasi
CMD ["npm", "run", "start:dev"]