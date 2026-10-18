import os
import sys
import paramiko
import time

sys.stdout.reconfigure(encoding='utf-8')

HOST = '163.5.16.156'
PORT = 22
USER = 'root'
PASS = 'nsJhCdGSRgX8Y'
REMOTE_SERVER_DIR = '/var/www/app/server'
REMOTE_LANDING_DIR = '/var/www/notos.tech'
VERSION = '0.5.25'

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
            print(f"  [SFTP] Uploaded {item} -> {rpath}", flush=True)

def main():
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    local_server_src = os.path.join(root_dir, 'apps', 'server', 'src')
    local_updates = os.path.join(root_dir, 'apps', 'server', 'updates')
    local_landing = os.path.join(root_dir, 'apps', 'landing')

    print(f"=== Step 1: Connecting to VPS via SSH ({HOST}) ===", flush=True)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=PORT, username=USER, password=PASS, timeout=25)
    sftp = ssh.open_sftp()
    print(f"[SSH] Connected to {USER}@{HOST}:{PORT}", flush=True)

    print("\n=== Step 2: Uploading updated server src/ files ===", flush=True)
    sftp_upload_dir(sftp, local_server_src, f"{REMOTE_SERVER_DIR}/src")

    print("\n=== Step 3: Compiling server on VPS (npm run build) ===", flush=True)
    build_cmd = f"cd {REMOTE_SERVER_DIR} && npm run build"
    stdin, stdout, stderr = ssh.exec_command(build_cmd)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    print(out, flush=True)
    if err:
        print(f"[Build Info/Warning] {err}", flush=True)

    print(f"\n=== Step 4: Uploading client update files v{VERSION} to VPS ===", flush=True)
    try:
        sftp.mkdir(f"{REMOTE_SERVER_DIR}/updates")
    except IOError:
        pass

    update_files = [f'NotOS-Update-{VERSION}.zip', f'NotOS-Setup-{VERSION}.exe', 'version.json']
    for fname in update_files:
        lpath = os.path.join(local_updates, fname)
        rpath = f"{REMOTE_SERVER_DIR}/updates/{fname}"
        if os.path.exists(lpath):
            size_mb = os.path.getsize(lpath) / 1024 / 1024
            print(f"  [SFTP] Uploading {fname} ({size_mb:.2f} MB)...", flush=True)
            sftp.put(lpath, rpath)
            print(f"  [SFTP] Uploaded {fname} successfully.", flush=True)
        else:
            print(f"  [SFTP] Warning: {lpath} does not exist, skipping.", flush=True)

    print("\n=== Step 5: Uploading landing page files (v0.5.25) ===", flush=True)
    for fname in ['index.html', 'script.js', 'styles.css']:
        lpath = os.path.join(local_landing, fname)
        rpath = f"{REMOTE_LANDING_DIR}/{fname}"
        if os.path.exists(lpath):
            sftp.put(lpath, rpath)
            print(f"  [SFTP] Uploaded {fname} -> {rpath}", flush=True)

    local_assets = os.path.join(local_landing, 'assets')
    if os.path.exists(local_assets):
        sftp_upload_dir(sftp, local_assets, f"{REMOTE_LANDING_DIR}/assets")

    print("\n=== Step 6: Restarting server via PM2 and reloading Nginx ===", flush=True)
    stdin, stdout, stderr = ssh.exec_command("pm2 restart notoc-server || pm2 restart server || pm2 restart all")
    print(stdout.read().decode('utf-8', errors='replace'), flush=True)

    stdin, stdout, stderr = ssh.exec_command("nginx -t && nginx -s reload")
    print(stdout.read().decode('utf-8', errors='replace'), flush=True)

    time.sleep(2)
    stdin, stdout, stderr = ssh.exec_command("pm2 status")
    print(stdout.read().decode('utf-8', errors='replace'), flush=True)

    sftp.close()
    ssh.close()
    print(f"\n=== Full Deployment of v{VERSION} to VPS & Landing complete! ===", flush=True)

if __name__ == '__main__':
    main()
