import paramiko

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('163.5.16.156', port=22, username='root', password='nsJhCdGSRgX8Y', timeout=10)

cmd = 'docker exec notoc-db psql -U notoc -d notoc -c "SELECT id, login, nickname, role FROM users;"'
stdin, stdout, stderr = ssh.exec_command(cmd)
print("Users in DB:")
print(stdout.read().decode('utf-8', errors='replace'))
print(stderr.read().decode('utf-8', errors='replace'))

update_cmd = """docker exec notoc-db psql -U notoc -d notoc -c "UPDATE users SET role = 'dev' WHERE LOWER(nickname) IN ('notqqqqq', 'neon_admin') OR LOWER(login) IN ('notqqqqq', 'neon_admin');" """
stdin, stdout, stderr = ssh.exec_command(update_cmd)
print("Update result:")
print(stdout.read().decode('utf-8', errors='replace'))
print(stderr.read().decode('utf-8', errors='replace'))

stdin, stdout, stderr = ssh.exec_command(cmd)
print("Users after update:")
print(stdout.read().decode('utf-8', errors='replace'))

ssh.close()
