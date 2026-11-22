# Sitio estático de Oasis servido con nginx (EasyPanel: tipo "Dockerfile", puerto 80).
# El Worker de reservas (carpeta worker/) NO va aquí: se despliega aparte en Cloudflare.
FROM nginx:1.27-alpine
COPY index.html favicon.svg /usr/share/nginx/html/
COPY css /usr/share/nginx/html/css
COPY js /usr/share/nginx/html/js
EXPOSE 80
