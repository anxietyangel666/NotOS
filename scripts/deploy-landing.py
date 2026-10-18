import os
import sys
import paramiko

sys.stdout.reconfigure(encoding='utf-8')

HOST = '163.5.16.156'
PORT = 22
USER = 'root'
PASS = 'nsJhCdGSRgX8Y'
REMOTE_LANDING_DIR = '/var/www/notos.tech'

NGINX_CONF = """server {
    listen 7443 ssl http2 proxy_protocol;
    listen [::]:7443 ssl http2 proxy_protocol;
    server_name notos.tech www.notos.tech;

    ssl_certificate /etc/letsencrypt/live/notos.tech/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/notos.tech/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    root /var/www/notos.tech;
    index index.html;

    set_real_ip_from 127.0.0.1;
    real_ip_header proxy_protocol;

    # Static assets caching
    location ~* \\.(jpg|jpeg|png|gif|ico|css|js|svg|woff2|woff|ttf)$ {
        expires 7d;
        add_header Cache-Control "public, no-transform";
    }

    # API Proxy to NotOS backend on port 4000
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $proxy_protocol_addr;
        proxy_set_header X-Forwarded-For $proxy_protocol_addr;
        proxy_set_header X-Forwarded-Proto https;
    }

    # Updates and Installer direct download
    location /updates/ {
        proxy_pass http://127.0.0.1:4000/updates/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $proxy_protocol_addr;
        proxy_set_header X-Forwarded-For $proxy_protocol_addr;
        proxy_set_header X-Forwarded-Proto https;
    }

    # Health check for live monitoring badge
    location /health {
        proxy_pass http://127.0.0.1:4000/health;
        proxy_set_header Host $host;
    }

    # Default fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}

server {
    listen 80;
    server_name notos.tech www.notos.tech;
    return 301 https://$host$request_uri;
}
"""

def sftp_upload_dir(sftp, local_dir, remote_dir):
    try:
        sftp.mkdir(remote_dir)
    except IOError:
        pass
    for item in os.listdir(local_dir):
        lpath = os.path.join(local_dir, item)
        rpath = f"{remote_dir}/{item}"
        if os.path.isdir(lpath):
            sftp_upload_dir(sftp, lpath, rpath)
        else:
            sftp.put(lpath, rpath)
            print(f"  [SFTP] Uploaded {item} -> {rpath}")

def main():
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    local_landing = os.path.join(root_dir, 'apps', 'landing')

    print("=== Step 1: Connecting to VPS via SSH ===")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=PORT, username=USER, password=PASS, timeout=45, banner_timeout=45)
    sftp = ssh.open_sftp()
    print(f"[SSH] Connected to {USER}@{HOST}:{PORT}")

    print("\n=== Step 2: Uploading Landing Page Files ===")
    sftp_upload_dir(sftp, local_landing, REMOTE_LANDING_DIR)

    print("\n=== Step 3: Updating stream.conf for SNI routing ===")
    stream_path = '/etc/nginx/stream-enabled/stream.conf'
    with sftp.open(stream_path, 'r') as f:
        stream_content = f.read().decode('utf-8')

    if 'notos.tech' not in stream_content:
        # Insert before default
        target = 'default                   to_reality;'
        replacement = '    notos.tech                to_web;\n    www.notos.tech            to_web;\n    default                   to_reality;'
        stream_content = stream_content.replace(target, replacement)
        with sftp.open(stream_path, 'w') as f:
            f.write(stream_content)
        print("[SFTP] Added notos.tech and www.notos.tech to stream.conf")
    else:
        print("[Info] notos.tech already present in stream.conf")

    print("\n=== Step 4: Configuring Nginx for notos.tech (7443 proxy_protocol) ===")
    nginx_conf_path = '/etc/nginx/sites-available/notos.tech'
    with sftp.open(nginx_conf_path, 'w') as f:
        f.write(NGINX_CONF)
    print(f"[SFTP] Written {nginx_conf_path}")

    # Symlink to sites-enabled
    ssh.exec_command('ln -sf /etc/nginx/sites-available/notos.tech /etc/nginx/sites-enabled/notos.tech')
    print("[SSH] Verified symlink in /etc/nginx/sites-enabled/")

    # Test and reload nginx
    stdin, stdout, stderr = ssh.exec_command('nginx -t && systemctl reload nginx')
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    print(out)
    if 'successful' in out or 'successful' in err:
        print("[SUCCESS] Nginx configuration is valid and reloaded!")
    else:
        print(f"[Warning] Nginx test output:\n{err}")

    sftp.close()
    ssh.close()
    print("\n[DEPLOY FINISHED] notos.tech is configured and active!")

if __name__ == '__main__':
    main()
