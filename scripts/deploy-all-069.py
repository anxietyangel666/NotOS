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
VERSION = '0.5.20'

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
    local_src = os.path.join(root_dir, 'apps', 'server', 'src')
    local_updates = os.path.join(root_dir, 'apps', 'server', 'updates')

    print("=== Step 1: Connecting to VPS via SSH ===", flush=True)
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=PORT, username=USER, password=PASS, timeout=20)
    sftp = ssh.open_sftp()
    print(f"[SSH] Connected to {USER}@{HOST}:{PORT}", flush=True)

    print("\n=== Step 2: Uploading updated server src/ files ===", flush=True)
    sftp_upload_dir(sftp, local_src, f"{REMOTE_SERVER_DIR}/src")

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

    update_files = [f'NotOS-Update-{VERSION}.zip', 'version.json']
    installer_path = os.path.join(local_updates, f'NotOS-Setup-{VERSION}.exe')
    if os.path.exists(installer_path):
        update_files.append(f'NotOS-Setup-{VERSION}.exe')

    for fname in update_files:
        lpath = os.path.join(local_updates, fname)
        rpath = f"{REMOTE_SERVER_DIR}/updates/{fname}"
        if os.path.exists(lpath):
            print(f"  [SFTP] Uploading {fname} ({os.path.getsize(lpath) / 1024 / 1024:.2f} MB)...", flush=True)
            sftp.put(lpath, rpath)
            print(f"  [SFTP] Uploaded {fname} successfully.", flush=True)
        else:
            print(f"  [SFTP] Warning: {lpath} does not exist, skipping.", flush=True)

    print("\n=== Step 5: Restarting server via PM2 ===", flush=True)
    stdin, stdout, stderr = ssh.exec_command("pm2 restart notoc-server || pm2 restart server || pm2 restart all")
    print(stdout.read().decode('utf-8', errors='replace'), flush=True)

    time.sleep(2)
    stdin, stdout, stderr = ssh.exec_command("pm2 status")
    print(stdout.read().decode('utf-8', errors='replace'), flush=True)

    sftp.close()
    ssh.close()
    print(f"\n=== Deployment of v{VERSION} to VPS complete! ===", flush=True)

if __name__ == '__main__':
    main()
