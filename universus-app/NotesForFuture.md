# Hosting for real

* **Development**: the API serves the folder as above.
* **Production**: don’t have the Node API serve thousands of images. Upload cards_images/ to a bucket or CDN (R2, S3, or nginx on your server) and set IMAGE_BASE_URL=https://images.yourdomain.com. Leave IMAGES_DIR empty. Nothing else changes.
* Use the same layout in the bucket (sf62x/027-mini.jpg). Don’t commit the images to either repo.